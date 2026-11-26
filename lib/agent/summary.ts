/**
 * Post-call summarisation + sentiment.
 *
 * Facts (requirements, lead score, properties, appointment) are read from the
 * database, never from the LLM. The LLM only writes the narrative summary,
 * classifies customer sentiment and proposes follow-ups — validated with Zod.
 */
import { z } from "zod";
import { db } from "@/lib/db";
import { chatCompletion } from "@/lib/agent/llm";
import { env } from "@/lib/env";
import { recomputeLeadScore } from "@/lib/leads";
import { formatINR } from "@/lib/format";
import { formatIST } from "@/lib/time";
import type { Prisma } from "@/lib/generated/prisma/client";

const llmSummarySchema = z.object({
  summary: z.string().min(10).max(1500),
  sentiment: z.enum(["POSITIVE", "NEUTRAL", "NEGATIVE"]),
  sentiment_reason: z.string().max(300),
  follow_up_recommendations: z.array(z.string().max(200)).min(1).max(5),
});

export async function generateCallSummary(conversationId: string) {
  const conv = await db.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    include: {
      customer: { include: { lead: true } },
      messages: { where: { role: { in: ["USER", "ASSISTANT"] } }, orderBy: { createdAt: "asc" } },
      appointments: { where: { status: "CONFIRMED" }, include: { property: true } },
    },
  });

  const breakdown = await recomputeLeadScore(conv.customerId);
  const lead = await db.lead.findUnique({ where: { customerId: conv.customerId } });
  const properties = await db.property.findMany({ where: { id: { in: conv.propertiesDiscussed } } });

  const transcript = conv.messages
    .filter((m) => m.content.trim())
    .map((m) => `${m.role === "USER" ? "Customer" : "Agent"}: ${m.content}`)
    .join("\n")
    .slice(-12_000);

  const requirements = {
    name: conv.customer.name,
    phone: conv.customer.phone ? "on file" : null,
    budget: lead?.budgetMaxInr ? formatINR(lead.budgetMaxInr) : null,
    budgetMaxInr: lead?.budgetMaxInr ?? null,
    preferredLocation: lead?.preferredLocation ?? null,
    bedrooms: lead?.bedrooms ?? null,
    propertyType: lead?.propertyType ?? null,
    timeline: lead?.timeline ?? null,
    buyingIntent: lead?.buyingIntent ?? null,
    notes: lead?.requirementsNotes ?? null,
  };

  let llm: z.infer<typeof llmSummarySchema>;
  if (!transcript) {
    llm = { summary: "The call ended before the customer said anything.", sentiment: "NEUTRAL", sentiment_reason: "No customer speech.", follow_up_recommendations: ["No action needed."] };
  } else {
    const { content } = await chatCompletion({
      jsonMode: true,
      model: env.summaryModel,
      temperature: 0.2,
      maxTokens: 600,
      messages: [
        {
          role: "system",
          content: `You analyse real-estate sales calls for a CRM. Return ONLY a JSON object:
{"summary": string (3-5 sentences, factual, third person), "sentiment": "POSITIVE"|"NEUTRAL"|"NEGATIVE" (the CUSTOMER's overall sentiment toward the conversation/offer, not the agent's), "sentiment_reason": string (one sentence citing evidence), "follow_up_recommendations": string[] (1-4 concrete next actions for the sales team)}
Do not invent facts not in the transcript or the structured data.`,
        },
        {
          role: "user",
          content: `Structured data (authoritative):\n${JSON.stringify({ requirements, leadScore: breakdown?.total, classification: breakdown?.classification, propertiesDiscussed: properties.map((p) => p.name), appointments: conv.appointments.map((a) => `${a.property.name} at ${formatIST(a.startsAt)}`) })}\n\nTranscript:\n${transcript}`,
        },
      ],
    });
    llm = llmSummarySchema.parse(JSON.parse(content ?? "{}"));
  }

  const appt = conv.appointments[0];
  const data = {
    customerRequirements: requirements as Prisma.InputJsonValue,
    summary: llm.summary,
    leadScore: breakdown?.total ?? 0,
    leadClassification: breakdown?.classification ?? "COLD",
    sentiment: llm.sentiment,
    sentimentReason: llm.sentiment_reason,
    propertiesDiscussed: properties.map((p) => ({ id: p.id, name: p.name, location: p.location, price: formatINR(p.priceInr) })) as Prisma.InputJsonValue,
    appointmentDetails: appt
      ? ({ id: appt.id, property: appt.property.name, startsAt: appt.startsAt.toISOString(), label: formatIST(appt.startsAt), status: appt.status } as Prisma.InputJsonValue)
      : undefined,
    followUpRecommendations: llm.follow_up_recommendations,
  };

  const [summary] = await db.$transaction([
    db.callSummary.upsert({ where: { conversationId }, create: { conversationId, ...data }, update: data }),
    db.conversation.update({ where: { id: conversationId }, data: { sentiment: llm.sentiment } }),
    db.lead.updateMany({ where: { customerId: conv.customerId }, data: { sentiment: llm.sentiment } }),
  ]);
  return summary;
}
