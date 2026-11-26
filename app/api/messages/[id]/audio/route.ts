import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { synthesizeStream } from "@/lib/speech";
import { handleRouteError, jsonError, uuidRe } from "@/lib/http";
import { rateLimit, tooManyRequests } from "@/lib/rate-limit";

/**
 * Streams TTS audio for an assistant message. The browser points an <audio>
 * element here, so playback starts while the TTS provider is still synthesising. Text is
 * loaded server-side by id — it never travels in the URL.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/messages/[id]/audio">) {
  const { id } = await ctx.params;
  if (!uuidRe.test(id)) return jsonError(400, "invalid_id", "Invalid message id.");
  const rl = rateLimit(req, "tts", 60);
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);
  try {
    const msg = await db.message.findUnique({ where: { id }, select: { role: true, content: true } });
    if (!msg || msg.role !== "ASSISTANT" || !msg.content.trim()) return jsonError(404, "not_found", "No speakable message.");
    const { stream, contentType } = await synthesizeStream(msg.content);
    return new Response(stream, { headers: { "Content-Type": contentType, "Cache-Control": "private, max-age=3600" } });
  } catch (e) {
    return handleRouteError(e, "GET /api/messages/[id]/audio");
  }
}
