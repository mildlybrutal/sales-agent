import "server-only";
import { ZodError } from "zod";
import { ConfigError } from "@/lib/env";
import { LLMError } from "@/lib/agent/llm";
import { ConversationError } from "@/lib/agent/orchestrator";

export function jsonError(status: number, error: string, message: string, extra: Record<string, unknown> = {}) {
  return Response.json({ error, message, ...extra }, { status });
}

/** Map known failures to safe client responses. Never logs request bodies, transcripts or PII. */
export function handleRouteError(e: unknown, route: string) {
  if (e instanceof ConfigError) return jsonError(503, "not_configured", e.message, { envVar: e.envVar });
  if (e instanceof ConversationError) {
    const status = e.code === "not_found" ? 404 : e.code === "busy" ? 409 : 410;
    return jsonError(status, e.code, e.message);
  }
  if (e instanceof ZodError) return jsonError(400, "invalid_request", "Invalid request.", { issues: e.issues.map((i) => i.message) });
  if (e instanceof LLMError) {
    console.error(`[${route}] LLM error status=${e.status} code=${e.code}`);
    if (e.status === 401) return jsonError(503, "not_configured", "GROQ_API_KEY was rejected by Groq.", { envVar: "GROQ_API_KEY" });
    if (e.status === 429) {
      const sec = e.retryAfterMs ? Math.ceil(e.retryAfterMs / 1000) : null;
      return Response.json(
        { error: "llm_rate_limited", message: `The AI provider's rate limit was reached${sec ? ` — please try again in about ${sec}s` : ". Please try again in a moment"}.`, retryAfterSec: sec },
        { status: 429, headers: sec ? { "Retry-After": String(sec) } : {} },
      );
    }
    return jsonError(502, "llm_error", "The AI service had a problem. Please try again.");
  }
  console.error(`[${route}] unexpected error:`, e instanceof Error ? `${e.name}: ${e.message.slice(0, 200)}` : "unknown");
  return jsonError(500, "internal_error", "Something went wrong. Please try again.");
}

export { uuidRe } from "@/lib/ids";
