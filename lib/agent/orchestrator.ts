/**
 * Agent orchestrator: one customer utterance in → one spoken reply out.
 *
 *   load memory (DB) → build system prompt → LLM ⇄ tools loop (≤5 steps)
 *   → persist every message (user, assistant tool-calls, tool results, reply)
 *
 * Conversation state lives entirely in Postgres, so the server is stateless
 * between turns and a page refresh resumes the same call.
 */
import "server-only";
import { db } from "@/lib/db";
import { requireGroqKey } from "@/lib/env";
import { chatCompletion, type ChatMessage, type ToolCall } from "@/lib/agent/llm";
import { buildSystemPrompt } from "@/lib/agent/prompt";
import { executeTool, toolSpecs, type ToolContext } from "@/lib/agent/tools";
import { missingQualificationFields } from "@/lib/leads";
import { formatIST } from "@/lib/time";
import type { Prisma } from "@/lib/generated/prisma/client";

const MAX_TOOL_STEPS = 5;
const HISTORY_WINDOW = 30;
/** Tool results from earlier turns are trimmed: the key facts (requirements, properties
 *  discussed with refs, pending booking) are re-injected via the system prompt anyway. */
const OLD_TOOL_RESULT_CHARS = 600;

export interface ToolEvent {
  name: string;
  ok: boolean;
  display: string;
}

export interface TurnResult {
  userMessageId: string;
  assistantMessage: { id: string; content: string };
  toolEvents: ToolEvent[];
  appointmentId?: string;
  summaryGenerated: boolean;
  latencyMs: number;
}

export class ConversationError extends Error {
  constructor(public code: "not_found" | "ended" | "busy", message: string) {
    super(message);
  }
}

// Serialise turns per conversation (single-instance lock; see ARCHITECTURE.md for the distributed version).
const g = globalThis as unknown as { __turnLocks?: Set<string> };
const locks = (g.__turnLocks ??= new Set());

export async function runTurn(conversationId: string, userText: string, opts: { sttLatencyMs?: number } = {}): Promise<TurnResult> {
  requireGroqKey(); // fail fast, before persisting anything
  if (locks.has(conversationId)) throw new ConversationError("busy", "Still processing the previous turn.");
  locks.add(conversationId);
  try {
    return await runTurnInner(conversationId, userText, opts);
  } finally {
    locks.delete(conversationId);
  }
}

async function runTurnInner(conversationId: string, userText: string, opts: { sttLatencyMs?: number }): Promise<TurnResult> {
  const started = Date.now();
  const conv = await db.conversation.findUnique({ where: { id: conversationId }, select: { id: true, status: true, customerId: true, turnCount: true } });
  if (!conv) throw new ConversationError("not_found", "Conversation not found.");
  if (conv.status === "ENDED") throw new ConversationError("ended", "This call has ended.");

  const turnIndex = conv.turnCount + 1;
  const userMsg = await db.message.create({
    data: { conversationId, role: "USER", content: userText, turnIndex, latencyMs: opts.sttLatencyMs },
  });
  await db.conversation.update({ where: { id: conversationId }, data: { turnCount: turnIndex } });

  const ctx: ToolContext = { conversationId, customerId: conv.customerId, turnIndex };
  const history = await loadHistory(conversationId);
  const tools = toolSpecs();
  const toolEvents: ToolEvent[] = [];
  let appointmentId: string | undefined;
  let summaryGenerated = false;

  for (let step = 0; step <= MAX_TOOL_STEPS; step++) {
    const system = await buildContextPrompt(conversationId, ctx.customerId);
    const { content, toolCalls } = await chatCompletion({
      messages: [{ role: "system", content: system }, ...history],
      // On the final step withhold tools to force a spoken answer.
      tools: step < MAX_TOOL_STEPS ? tools : undefined,
    });

    if (!toolCalls.length) {
      const reply = cleanForSpeech(content) || "Sorry, could you say that again?";
      const msg = await db.message.create({
        data: { conversationId, role: "ASSISTANT", content: reply, turnIndex, latencyMs: Date.now() - started },
      });
      return { userMessageId: userMsg.id, assistantMessage: { id: msg.id, content: reply }, toolEvents, appointmentId, summaryGenerated, latencyMs: Date.now() - started };
    }

    // Persist the assistant's tool-call request, then each tool result.
    await db.message.create({
      data: { conversationId, role: "ASSISTANT", content: content ?? "", toolCalls: toolCalls as unknown as Prisma.InputJsonValue, turnIndex },
    });
    history.push({ role: "assistant", content: content ?? "", tool_calls: toolCalls });

    for (const call of toolCalls) {
      const outcome = await executeTool(call.function.name, call.function.arguments, ctx);
      toolEvents.push({ name: call.function.name, ok: outcome.ok, display: outcome.display });
      if (outcome.effects?.appointmentId) appointmentId = outcome.effects.appointmentId;
      if (outcome.effects?.summaryGenerated) summaryGenerated = true;
      const resultJson = JSON.stringify(outcome.result);
      await db.message.create({
        data: { conversationId, role: "TOOL", content: resultJson, toolCallId: call.id, toolName: call.function.name, turnIndex },
      });
      history.push({ role: "tool", content: resultJson, tool_call_id: call.id });
    }
  }
  throw new Error("unreachable");
}

/** Rebuild OpenAI-format history from the DB, starting at a user message so tool pairs are never split. */
async function loadHistory(conversationId: string): Promise<ChatMessage[]> {
  const rows = await db.message.findMany({ where: { conversationId }, orderBy: { createdAt: "desc" }, take: HISTORY_WINDOW });
  rows.reverse();
  const firstUser = rows.findIndex((m) => m.role === "USER");
  const windowed = firstUser > 0 && rows.length === HISTORY_WINDOW ? rows.slice(firstUser) : rows;
  return windowed.map((m): ChatMessage => {
    if (m.role === "USER") return { role: "user", content: m.content };
    if (m.role === "TOOL") {
      const content = m.content.length > OLD_TOOL_RESULT_CHARS ? `${m.content.slice(0, OLD_TOOL_RESULT_CHARS)}… [earlier result truncated]` : m.content;
      return { role: "tool", content, tool_call_id: m.toolCallId ?? "" };
    }
    const calls = m.toolCalls as unknown as ToolCall[] | null;
    return calls?.length ? { role: "assistant", content: m.content || null, tool_calls: calls } : { role: "assistant", content: m.content };
  });
}

/** Memory injection: everything persisted about the customer goes into the system prompt each step. */
async function buildContextPrompt(conversationId: string, customerId: string) {
  const [conv, customer] = await Promise.all([
    db.conversation.findUniqueOrThrow({ where: { id: conversationId }, select: { pendingBooking: true, propertiesDiscussed: true } }),
    db.customer.findUniqueOrThrow({
      where: { id: customerId },
      include: {
        lead: true,
        conversations: { where: { id: { not: conversationId }, summary: { isNot: null } }, orderBy: { startedAt: "desc" }, take: 3, include: { summary: true } },
      },
    }),
  ]);
  const discussed = conv.propertiesDiscussed.length
    ? await db.property.findMany({ where: { id: { in: conv.propertiesDiscussed } }, select: { name: true, slug: true } })
    : [];
  const pending = conv.pendingBooking as { propertyId: string; startsAt: string } | null;
  const pendingProperty = pending ? await db.property.findUnique({ where: { id: pending.propertyId }, select: { name: true } }) : null;

  const lead = customer.lead;
  return buildSystemPrompt({
    customer: { name: customer.name, phone: customer.phone, isReturning: customer.conversations.length > 0 },
    lead,
    missing: lead
      ? missingQualificationFields(lead, customer)
      : ["name", "budget", "preferred_location", "bedrooms", "property_type", "purchase_timeline", "buying_intent"],
    pendingBooking: pending && pendingProperty ? { propertyName: pendingProperty.name, when: formatIST(new Date(pending.startsAt)) } : null,
    previousEnquiries: customer.conversations.map((c) => `${formatIST(c.startedAt)}: ${c.summary!.summary}`),
    propertiesDiscussed: discussed.map((p) => `${p.name} (ref: ${p.slug})`),
  });
}

/** Strip anything that would sound wrong when spoken. */
function cleanForSpeech(text: string | null) {
  return (text ?? "")
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/[*_#`>|]/g, "")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
