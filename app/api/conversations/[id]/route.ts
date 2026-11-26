import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handleRouteError, jsonError, uuidRe } from "@/lib/http";

/** Full conversation state, used to resume a call after a page refresh. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/conversations/[id]">) {
  const { id } = await ctx.params;
  if (!uuidRe.test(id)) return jsonError(400, "invalid_id", "Invalid conversation id.");
  try {
    const conv = await db.conversation.findUnique({
      where: { id },
      include: {
        customer: { include: { lead: true } },
        messages: { orderBy: { createdAt: "asc" } },
        summary: true,
        appointments: { include: { property: { select: { name: true, location: true, address: true } } }, orderBy: { startsAt: "asc" } },
      },
    });
    if (!conv) return jsonError(404, "not_found", "Conversation not found.");
    return Response.json(serializeConversation(conv));
  } catch (e) {
    return handleRouteError(e, "GET /api/conversations/[id]");
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeConversation(conv: any) {
  return {
    id: conv.id,
    status: conv.status,
    startedAt: conv.startedAt,
    endedAt: conv.endedAt,
    durationSec: conv.durationSec,
    sentiment: conv.sentiment,
    customer: { id: conv.customer.id, name: conv.customer.name, hasPhone: Boolean(conv.customer.phone) },
    lead: conv.customer.lead,
    appointments: conv.appointments,
    summary: conv.summary,
    messages: conv.messages.map((m: { id: string; role: string; content: string; toolName: string | null; toolCalls: unknown; turnIndex: number; createdAt: Date }) => ({
      id: m.id,
      role: m.role,
      // Tool payloads stay server-side; the UI only needs the tool name.
      content: m.role === "TOOL" ? undefined : m.content,
      toolName: m.toolName,
      hasToolCalls: Boolean(m.toolCalls),
      turnIndex: m.turnIndex,
      createdAt: m.createdAt,
    })),
  };
}
