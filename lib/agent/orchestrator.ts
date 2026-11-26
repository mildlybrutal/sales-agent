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
import { chatCompletion, type ChatMessage } from "@/lib/agent/llm";
import { buildSystemPrompt } from "@/lib/agent/prompt";
import { executeTool, toolSpecs, type ToolContext } from "@/lib/agent/tools";
import { missingQualificationFields } from "@/lib/leads";
import { formatIST, istParts } from "@/lib/time";
import type { Prisma } from "@/lib/generated/prisma/client";

const MAX_TOOL_STEPS = 5;
/** Spoken exchanges (customer + agent text) from earlier turns kept in the LLM context.
 *  Earlier tool calls/results are NOT resent: the facts they produced (requirements,
 *  properties discussed with refs, the held slot) are re-injected via the system prompt.
 *  This keeps each call small enough for Groq's free-tier per-minute token budget. */
const HISTORY_WINDOW = 12;

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
  /** Total LLM tokens (prompt + completion) used by this turn, as reported by the provider. */
  tokens: number;
  llmCalls: number;
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
  const toolEvents: ToolEvent[] = [];
  let tokens = 0;
  const models = new Set<string>();
  let appointmentId: string | undefined;
  let summaryGenerated = false;

  for (let step = 0; step <= MAX_TOOL_STEPS; step++) {
    const { system, excludeTools } = await buildContextPrompt(conversationId, ctx.customerId);
    const res = await chatCompletion({
      messages: [{ role: "system", content: system }, ...history],
      // On the final step withhold tools to force a spoken answer.
      tools: step < MAX_TOOL_STEPS ? toolSpecs(excludeTools) : undefined,
    });
    const { content, toolCalls } = res;
    tokens += res.usage.totalTokens;
    models.add(res.model);

    if (!toolCalls.length) {
      const reply = cleanForSpeech(content) || "Sorry, could you say that again?";
      const latencyMs = Date.now() - started;
      const msg = await db.message.create({
        data: { conversationId, role: "ASSISTANT", content: reply, turnIndex, latencyMs, tokens },
      });
      // PII-free usage line, to see how a turn spends the provider's token budget.
      console.info(`[agent] turn tokens=${tokens} calls=${step + 1} tools=${toolEvents.length} model=${[...models].join(",")} ms=${latencyMs}`);
      return { userMessageId: userMsg.id, assistantMessage: { id: msg.id, content: reply }, toolEvents, appointmentId, summaryGenerated, latencyMs, tokens, llmCalls: step + 1 };
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

/** Rebuild the spoken conversation (customer + agent text only) from the DB. Tool traffic
 *  from earlier turns is omitted; the current turn's tool calls are appended in memory. */
async function loadHistory(conversationId: string): Promise<ChatMessage[]> {
  const rows = await db.message.findMany({
    where: { conversationId, role: { in: ["USER", "ASSISTANT"] } },
    orderBy: { createdAt: "desc" },
    take: HISTORY_WINDOW * 3, // headroom for assistant tool-call rows filtered out below
    select: { role: true, content: true, toolCalls: true },
  });
  return rows
    .filter((m) => m.role === "USER" || (!m.toolCalls && m.content.trim()))
    .slice(0, HISTORY_WINDOW)
    .reverse()
    .map((m): ChatMessage => (m.role === "USER" ? { role: "user", content: m.content } : { role: "assistant", content: m.content }));
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
  const pendingProperty = pending ? await db.property.findUnique({ where: { id: pending.propertyId }, select: { name: true, slug: true } }) : null;
  const pendingAt = pending ? new Date(pending.startsAt) : null;

  const lead = customer.lead;
  const system = buildSystemPrompt({
    customer: { name: customer.name, phone: customer.phone, isReturning: customer.conversations.length > 0 },
    lead,
    missing: lead
      ? missingQualificationFields(lead, customer)
      : ["name", "budget", "preferred_location", "bedrooms", "property_type", "purchase_timeline", "buying_intent"],
    pendingBooking:
      pendingProperty && pendingAt
        ? { propertyName: pendingProperty.name, propertyRef: pendingProperty.slug, ...istParts(pendingAt), when: formatIST(pendingAt) }
        : null,
    previousEnquiries: customer.conversations.map((c) => `${formatIST(c.startedAt)}: ${c.summary!.summary}`),
    propertiesDiscussed: discussed.map((p) => `${p.name} (ref ${p.slug})`),
  });
  // Only offer tools that can apply right now (fewer tokens per call).
  const excludeTools = [...(pending ? [] : ["book_appointment"]), ...(customer.phone ? ["get_customer_history"] : [])];
  return { system, excludeTools };
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
