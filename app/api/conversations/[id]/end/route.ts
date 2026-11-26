import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { generateCallSummary } from "@/lib/agent/summary";
import { handleRouteError, jsonError, uuidRe } from "@/lib/http";
import { rateLimit, tooManyRequests } from "@/lib/rate-limit";

/**
 * End a call (idempotent): marks it ENDED, records duration, and generates the
 * structured summary + sentiment if not already present. Also used by the
 * dashboard to (re)generate a summary for an abandoned call.
 */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/conversations/[id]/end">) {
  const { id } = await ctx.params;
  if (!uuidRe.test(id)) return jsonError(400, "invalid_id", "Invalid conversation id.");
  const rl = rateLimit(req, "end", 10);
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);
  const regenerate = req.nextUrl.searchParams.get("regenerate") === "1";

  try {
    const conv = await db.conversation.findUnique({ where: { id }, include: { summary: { select: { id: true } } } });
    if (!conv) return jsonError(404, "not_found", "Conversation not found.");

    if (conv.status === "ACTIVE") {
      const last = await db.message.findFirst({ where: { conversationId: id }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
      const endedAt = new Date();
      // For calls abandoned without pressing "End", measure to the last message.
      const end = last && endedAt.getTime() - last.createdAt.getTime() > 10 * 60_000 ? last.createdAt : endedAt;
      await db.conversation.update({
        where: { id },
        data: { status: "ENDED", endedAt: end, durationSec: Math.max(0, Math.round((end.getTime() - conv.startedAt.getTime()) / 1000)), pendingBooking: undefined },
      });
    }

    const summary = conv.summary && !regenerate ? await db.callSummary.findUnique({ where: { conversationId: id } }) : await generateCallSummary(id);
    return Response.json({ status: "ENDED", summary });
  } catch (e) {
    return handleRouteError(e, "POST /api/conversations/[id]/end");
  }
}
