import { db } from "@/lib/db";
import { scoreLead, type ScoreBreakdown } from "@/lib/scoring";
import type { Prisma } from "@/lib/generated/prisma/client";

type Tx = Prisma.TransactionClient;

/** Recompute and persist the deterministic score for a customer's lead. */
export async function recomputeLeadScore(customerId: string, tx: Tx = db): Promise<ScoreBreakdown | null> {
  const lead = await tx.lead.findUnique({ where: { customerId } });
  if (!lead) return null;
  const [inventory, bookedVisits] = await Promise.all([
    tx.property.findMany({ select: { location: true, priceInr: true, bedrooms: true, propertyType: true, unitsAvailable: true } }),
    tx.appointment.count({ where: { customerId, status: { in: ["CONFIRMED", "COMPLETED"] } } }),
  ]);
  const breakdown = scoreLead(
    {
      budgetMaxInr: lead.budgetMaxInr,
      preferredLocation: lead.preferredLocation,
      propertyType: lead.propertyType,
      bedrooms: lead.bedrooms,
      timelineMonths: lead.timelineMonths,
      buyingIntent: lead.buyingIntent,
      hasBookedVisit: bookedVisits > 0,
    },
    inventory,
  );
  const known = [lead.budgetMaxInr, lead.preferredLocation, lead.timelineMonths, lead.buyingIntent].filter((x) => x != null).length;
  const stage = bookedVisits > 0 ? "VISIT_BOOKED" : known >= 4 ? "QUALIFIED" : known > 0 ? "QUALIFYING" : "NEW";
  await tx.lead.update({
    where: { customerId },
    data: {
      score: breakdown.total,
      classification: breakdown.classification,
      scoreBreakdown: breakdown as unknown as Prisma.InputJsonValue,
      stage,
    },
  });
  return breakdown;
}

export function missingQualificationFields(lead: {
  budgetMaxInr: number | null;
  preferredLocation: string | null;
  bedrooms: number | null;
  propertyType: string | null;
  timelineMonths: number | null;
  buyingIntent: string | null;
}, customer: { name: string | null; phone: string | null }) {
  const missing: string[] = [];
  if (!customer.name) missing.push("name");
  if (!lead.budgetMaxInr) missing.push("budget");
  if (!lead.preferredLocation) missing.push("preferred_location");
  if (lead.bedrooms == null) missing.push("bedrooms");
  if (!lead.propertyType) missing.push("property_type");
  if (lead.timelineMonths == null) missing.push("purchase_timeline");
  if (!lead.buyingIntent) missing.push("buying_intent");
  if (!customer.phone) missing.push("phone (optional)");
  return missing;
}
