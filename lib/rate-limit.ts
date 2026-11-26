/**
 * Fixed-window in-memory rate limiter keyed by client IP + bucket.
 * Good enough for a single-instance MVP; production should use Redis
 * (see docs/ARCHITECTURE.md).
 */
const g = globalThis as unknown as { __rl?: Map<string, { count: number; resetAt: number }> };
const store = (g.__rl ??= new Map());

export function rateLimit(req: Request, bucket: string, limit: number, windowMs = 60_000) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const entry = store.get(key);
  if (!entry || entry.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    if (store.size > 5000) for (const [k, v] of store) if (v.resetAt <= now) store.delete(k);
    return { ok: true as const };
  }
  entry.count++;
  if (entry.count > limit) return { ok: false as const, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) };
  return { ok: true as const };
}

export function tooManyRequests(retryAfterSec: number) {
  return Response.json({ error: "rate_limited", message: "Too many requests. Please slow down." }, { status: 429, headers: { "Retry-After": String(retryAfterSec) } });
}
