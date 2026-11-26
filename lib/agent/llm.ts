import "server-only";
import { env, providerFor, requireGroqKey, type LLMProvider } from "@/lib/env";
import { fetchWithRetry } from "@/lib/fetch-retry";

/** OpenAI-compatible chat message shapes (Groq implements this API). */
export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string };

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export class LLMError extends Error {
  constructor(public status: number, public code: string, message: string, public retryAfterMs?: number | null) {
    super(message);
    this.name = "LLMError";
  }
}



export interface CompletionResult {
  content: string | null;
  toolCalls: ToolCall[];
  /** Model that actually answered (may be the fallback). */
  model: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
}

/** Short waits are retried on the same model; anything longer switches model or fails fast. */
const SHORT_WAIT_MS = 3_000;
const MAX_RATE_LIMIT_WAIT_MS = 12_000;

export async function chatCompletion(opts: {
  messages: ChatMessage[];
  tools?: unknown[];
  jsonMode?: boolean;
  temperature?: number;
  maxTokens?: number;
  /** Defaults to GROQ_MODEL. */
  model?: string;
}): Promise<CompletionResult> {
  requireGroqKey();
  // Order: requested model → fallbacks → primary (so a summary on a fallback model can
  // still fall back). Rate limits are per model, so each model is a separate free quota.
  // Models whose provider has no API key configured are skipped.
  const models = [...new Set([opts.model ?? env.groqModel, ...env.fallbackModels, env.groqModel])].filter(
    (m) => Boolean(providerFor(m).apiKey),
  );
  let modelIdx = 0;

  const bodyFor = (model: string, provider: LLMProvider): Record<string, unknown> => {
    const maxTokens = opts.maxTokens ?? 300;
    if (provider.name === "gemini") {
      // Google's OpenAI-compatible endpoint: `max_tokens`, and stricter tool schemas.
      return {
        model,
        messages: opts.messages,
        temperature: opts.temperature ?? 0.4,
        max_tokens: maxTokens,
        // Thinking adds seconds of latency on a voice call; "none" disables it on 2.5 Flash
        // (measured ~1–3.5 s vs ~4–5.5 s with "low", same tool choice). 1.x / 2.0 reject the param.
        ...(env.geminiReasoningEffort && !/gemini-(1\.|2\.0)/i.test(model) ? { reasoning_effort: env.geminiReasoningEffort } : {}),
        ...(opts.tools?.length ? { tools: opts.tools.map(geminiTool), tool_choice: "auto" } : {}),
        ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
      };
    }
    return {
      model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.4,
      // Groq counts the *requested* max tokens against the per-minute token budget,
      // so keep this tight: spoken replies are ≤ ~60 words (+ low-effort reasoning).
      max_completion_tokens: maxTokens,
      ...(/gpt-oss|qwen3/i.test(model) ? { reasoning_effort: "low" } : {}),
      ...(opts.tools?.length ? { tools: opts.tools, tool_choice: "auto" } : {}),
      ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
    };
  };

  // Retries: transient 5xx and Groq's occasional `tool_use_failed` (malformed tool
  // call) once. 429s: a short wait is retried on the same model; a longer one
  // switches to the fallback model immediately; otherwise wait if it fits in a turn.
  let rateLimitRetries = 0;
  for (let attempt = 0; ; attempt++) {
    const model = models[modelIdx];
    const provider = providerFor(model);
    const res = await fetchWithRetry(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${provider.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(bodyFor(model, provider)),
      signal: AbortSignal.timeout(45_000),
    });
    if (res.ok) {
      const data = await res.json();
      const msg = data.choices?.[0]?.message ?? {};
      const u = data.usage ?? {};
      return {
        content: msg.content ?? null,
        toolCalls: msg.tool_calls ?? [],
        model: data.model ?? model,
        usage: { promptTokens: u.prompt_tokens ?? 0, completionTokens: u.completion_tokens ?? 0, totalTokens: u.total_tokens ?? 0 },
      };
    }
    let code = `http_${res.status}`;
    let message = res.statusText;
    try {
      // Groq: { error: { code, message } }. Gemini: [{ error: { status, message } }] or { error: {...} }.
      const raw = await res.json();
      const err = (Array.isArray(raw) ? raw[0] : raw)?.error;
      code = (typeof err?.code === "string" ? err.code : err?.status) || code;
      message = err?.message || message;
    } catch {}

    if (res.status === 429) {
      const waitMs = rateLimitWaitMs(res.headers, message);
      // Log only which limit was hit (e.g. "tokens per minute (TPM)") and the wait — no org id or payload.
      const limit = /(tokens|requests) per (minute|day) \((\w+)\)/i.exec(message)?.[0] ?? (provider.name === "gemini" ? "Gemini quota" : "unknown limit");
      const hasFallback = modelIdx < models.length - 1;
      const shortWait = waitMs != null && waitMs <= SHORT_WAIT_MS;
      console.warn(`[llm] ${model} rate limited: ${limit}; wait ${waitMs ?? "?"} ms${!shortWait && hasFallback ? ` → switching to ${models[modelIdx + 1]}` : ""}`);
      if (shortWait && rateLimitRetries < 2) {
        rateLimitRetries++;
        await sleep(waitMs + 250);
        continue;
      }
      if (hasFallback) {
        modelIdx++;
        rateLimitRetries = 0;
        continue;
      }
      if (rateLimitRetries < 2 && waitMs != null && waitMs <= MAX_RATE_LIMIT_WAIT_MS) {
        rateLimitRetries++;
        await sleep(waitMs + 250);
        continue;
      }
      throw new LLMError(429, code, message, waitMs);
    }
    const retryable = res.status >= 500 || code === "tool_use_failed";
    if (modelIdx > 0 && modelIdx < models.length - 1 && (!retryable || attempt >= 1)) {
      // A broken fallback (bad key, unknown model) shouldn't end the turn while another model remains.
      console.warn(`[llm] fallback ${model} failed: status=${res.status} code=${code}; trying ${models[modelIdx + 1]}`);
      modelIdx++;
      continue;
    }
    if (!retryable || attempt >= 1) throw new LLMError(res.status, code, message);
    await sleep(300);
  }
}

/** Gemini rejects function declarations with an empty `properties` object; omit parameters instead. */
function geminiTool(tool: unknown) {
  const t = tool as { type: string; function: { name: string; description: string; parameters?: { properties?: object } } };
  const params = t.function.parameters;
  if (params?.properties && Object.keys(params.properties).length === 0) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { parameters: _p, ...fn } = t.function;
    return { ...t, function: fn };
  }
  return t;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Groq sends `retry-after` (seconds) and a message like "Please try again in 1m2.5s" / "in 820ms". */
function rateLimitWaitMs(headers: Headers, message: string): number | null {
  const header = Number(headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return header * 1000;
  const m = /try again in (?:(\d+)m)?(?:([\d.]+)s)?(?:([\d.]+)ms)?/i.exec(message);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  return Math.ceil((Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * 1000 + Number(m[3] ?? 0));
}
