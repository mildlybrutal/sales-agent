import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { runTurn } from "@/lib/agent/orchestrator";
import { isLikelySilence, MAX_AUDIO_BYTES, transcribe } from "@/lib/speech";
import { handleRouteError, jsonError, uuidRe } from "@/lib/http";
import { rateLimit, tooManyRequests } from "@/lib/rate-limit";

const textBody = z.object({ text: z.string().trim().min(1).max(1000) });

/**
 * One conversational turn.
 *  - multipart/form-data with `audio` (webm/ogg/mp4/wav) → Whisper STT → agent
 *  - application/json { text } → agent (typed fallback)
 */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/conversations/[id]/turn">) {
  const { id } = await ctx.params;
  if (!uuidRe.test(id)) return jsonError(400, "invalid_id", "Invalid conversation id.");
  const rl = rateLimit(req, "turn", 30);
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  try {
    let text: string;
    let sttLatencyMs: number | undefined;
    const contentType = req.headers.get("content-type") ?? "";

    if (contentType.startsWith("multipart/form-data")) {
      const form = await req.formData();
      const audio = form.get("audio");
      if (!(audio instanceof Blob) || audio.size === 0) return jsonError(400, "missing_audio", "No audio received.");
      if (audio.size > MAX_AUDIO_BYTES) return jsonError(413, "audio_too_large", "Recording is too long. Please keep turns under a minute.");
      const ext = audio.type.includes("mp4") ? "mp4" : audio.type.includes("ogg") ? "ogg" : audio.type.includes("wav") ? "wav" : "webm";
      const t0 = Date.now();
      text = await transcribe(audio, `turn.${ext}`);
      sttLatencyMs = Date.now() - t0;
      if (isLikelySilence(text)) {
        return Response.json({ noSpeech: true, transcript: text, sttLatencyMs });
      }
    } else {
      const parsed = textBody.safeParse(await req.json().catch(() => ({})));
      if (!parsed.success) return jsonError(400, "invalid_request", "Provide `text` or an `audio` file.");
      text = parsed.data.text;
    }

    const result = await runTurn(id, text, { sttLatencyMs });
    const conv = await db.conversation.findUniqueOrThrow({
      where: { id },
      select: { pendingBooking: true, customer: { select: { name: true, phone: true, lead: true } } },
    });
    const appointment = result.appointmentId
      ? await db.appointment.findUnique({ where: { id: result.appointmentId }, include: { property: { select: { name: true, address: true } } } })
      : null;

    return Response.json({
      transcript: text,
      sttLatencyMs,
      ...result,
      customer: { name: conv.customer.name, hasPhone: Boolean(conv.customer.phone) },
      lead: conv.customer.lead,
      pendingBooking: conv.pendingBooking,
      appointment,
    });
  } catch (e) {
    return handleRouteError(e, "POST /api/conversations/[id]/turn");
  }
}
