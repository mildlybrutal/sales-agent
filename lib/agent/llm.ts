import "server-only";
import { env, requireGroqKey } from "@/lib/env";

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
  const key = requireGroqKey();
  // Groq rate limits are per model, so a second model is a second free quota bucket.
  // Order: requested model → fallback → primary (so a summary on the fallback model can still fall back).
  const models = [...new Set([opts.model ?? env.groqModel, env.groqFallbackModel, env.groqModel].filter(Boolean))] as string[];
  let modelIdx = 0;

  const bodyFor = (model: string): Record<string, unknown> => ({
    model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.4,
    // Groq counts the *requested* max tokens against the per-minute token budget,
    // so keep this tight: spoken replies are ≤ ~60 words (+ low-effort reasoning).
    max_completion_tokens: opts.maxTokens ?? 300,
    ...(/gpt-oss|qwen3/i.test(model) ? { reasoning_effort: "low" } : {}),
    ...(opts.tools?.length ? { tools: opts.tools, tool_choice: "auto" } : {}),
    ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
  });

  // Retries: transient 5xx and Groq's occasional `tool_use_failed` (malformed tool
  // call) once. 429s: a short wait is retried on the same model; a longer one
  // switches to the fallback model immediately; otherwise wait if it fits in a turn.
  let rateLimitRetries = 0;
  for (let attempt = 0; ; attempt++) {
    const model = models[modelIdx];
    const res = await fetch(`${env.groqBaseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(bodyFor(model)),
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
      const err = await res.json();
      code = err?.error?.code || code;
      message = err?.error?.message || message;
    } catch {}

    if (res.status === 429) {
      const waitMs = rateLimitWaitMs(res.headers, message);
      // Log only which limit was hit (e.g. "tokens per minute (TPM)") and the wait — no org id or payload.
      const limit = /(tokens|requests) per (minute|day) \((\w+)\)/i.exec(message)?.[0] ?? "unknown limit";
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
    if (!retryable || attempt >= 1) throw new LLMError(res.status, code, message);
    await sleep(300);
  }
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
