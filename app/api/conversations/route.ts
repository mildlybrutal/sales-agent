import { z } from "zod";
import { db } from "@/lib/db";
import { GREETING } from "@/lib/agent/prompt";
import { getPublicConfigStatus } from "@/lib/env";
import { handleRouteError, jsonError } from "@/lib/http";
import { rateLimit, tooManyRequests } from "@/lib/rate-limit";

const body = z.object({
  /** Explicit consent to record, transcribe and store the call. Required. */
  consent: z.literal(true),
});

/** Start a call: requires consent, creates an anonymous customer + conversation, stores the greeting. */
export async function POST(req: Request) {
  const rl = rateLimit(req, "create", 10);
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);
  try {
    const parsed = body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return jsonError(400, "consent_required", "Consent to record and store the call is required.");

    const conversation = await db.$transaction(async (tx) => {
      const customer = await tx.customer.create({ data: { lead: { create: {} } } });
      const c = await tx.conversation.create({ data: { customerId: customer.id, consentGivenAt: new Date() } });
      const greeting = await tx.message.create({ data: { conversationId: c.id, role: "ASSISTANT", content: GREETING, turnIndex: 0 } });
      return { ...c, greeting };
    });

    return Response.json(
      {
        id: conversation.id,
        greeting: { id: conversation.greeting.id, content: GREETING },
        config: getPublicConfigStatus(),
      },
      { status: 201 },
    );
  } catch (e) {
    return handleRouteError(e, "POST /api/conversations");
  }
}
