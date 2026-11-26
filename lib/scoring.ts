/**
 * Deterministic lead scoring (0–100). Pure function of the lead's stated
 * requirements and the live inventory — no LLM involved, so the same inputs
 * always give the same score and every point is explainable.
 *
 *   Budget matches inventory      30
 *   Purchase timeline             30
 *   Buying intent                 25
 *   Requirement matches inventory 15
 *
 *   HOT 75–100 · WARM 45–74 · COLD 0–44
 */
import type { BuyingIntent, LeadClassification, PropertyType } from "@/lib/generated/prisma/enums";

export interface ScoringInput {
  budgetMaxInr: number | null;
  preferredLocation: string | null;
  propertyType: PropertyType | null;
  bedrooms: number | null;
  timelineMonths: number | null;
  buyingIntent: BuyingIntent | null;
  hasBookedVisit: boolean;
}

export interface InventoryItem {
  location: string;
  priceInr: number;
  bedrooms: number;
  propertyType: PropertyType;
  unitsAvailable: number;
}

export interface ScoreBreakdown {
  budget: number;
  timeline: number;
  intent: number;
  requirementMatch: number;
  total: number;
  classification: LeadClassification;
  reasons: string[];
}

export function classify(score: number): LeadClassification {
  if (score >= 75) return "HOT";
  if (score >= 45) return "WARM";
  return "COLD";
}

export function scoreLead(input: ScoringInput, inventory: InventoryItem[]): ScoreBreakdown {
  const reasons: string[] = [];
  const available = inventory.filter((p) => p.unitsAvailable > 0);
  const inLocation = input.preferredLocation
    ? available.filter((p) => p.location.toLowerCase() === input.preferredLocation!.toLowerCase())
    : available;

  // 1. Budget vs inventory (30)
  let budget = 0;
  if (input.budgetMaxInr) {
    const pool = inLocation.length ? inLocation : available;
    const cheapest = Math.min(...pool.map((p) => p.priceInr));
    if (pool.some((p) => p.priceInr <= input.budgetMaxInr!)) {
      budget = 30;
      reasons.push("Budget covers available inventory");
    } else if (cheapest <= input.budgetMaxInr * 1.15) {
      budget = 15;
      reasons.push("Budget within 15% of available inventory");
    } else {
      reasons.push("Budget below available inventory");
    }
  } else {
    reasons.push("Budget not yet shared");
  }

  // 2. Timeline (30)
  let timeline = 0;
  const m = input.timelineMonths;
  if (m == null) reasons.push("Purchase timeline unknown");
  else if (m <= 3) { timeline = 30; reasons.push("Buying within 3 months"); }
  else if (m <= 6) { timeline = 22; reasons.push("Buying within 6 months"); }
  else if (m <= 12) { timeline = 12; reasons.push("Buying within 12 months"); }
  else { timeline = 5; reasons.push("Timeline beyond 12 months"); }

  // 3. Buying intent (25). A booked site visit is treated as strong intent.
  const effectiveIntent: BuyingIntent | null = input.hasBookedVisit ? "HIGH" : input.buyingIntent;
  const intent = effectiveIntent === "HIGH" ? 25 : effectiveIntent === "MEDIUM" ? 15 : effectiveIntent === "LOW" ? 5 : 0;
  if (input.hasBookedVisit) reasons.push("Site visit booked (high intent)");
  else if (effectiveIntent) reasons.push(`${effectiveIntent.toLowerCase()} buying intent`);
  else reasons.push("Buying intent not assessed");

  // 4. Requirement match (15): properties satisfying every stated criterion.
  let requirementMatch = 0;
  const criteriaKnown = [input.preferredLocation, input.bedrooms, input.propertyType, input.budgetMaxInr].filter((x) => x != null).length;
  if (criteriaKnown > 0) {
    const matches = available.filter(
      (p) =>
        (!input.preferredLocation || p.location.toLowerCase() === input.preferredLocation.toLowerCase()) &&
        (input.bedrooms == null || p.bedrooms === input.bedrooms) &&
        (!input.propertyType || p.propertyType === input.propertyType) &&
        (!input.budgetMaxInr || p.priceInr <= input.budgetMaxInr),
    );
    if (matches.length && input.preferredLocation && input.bedrooms != null) {
      requirementMatch = 15;
      reasons.push(`${matches.length} propert${matches.length === 1 ? "y" : "ies"} match all requirements`);
    } else if (matches.length) {
      requirementMatch = 8;
      reasons.push("Partial requirements match inventory");
    } else {
      reasons.push("No available property matches all requirements");
    }
  }

  const total = budget + timeline + intent + requirementMatch;
  return { budget, timeline, intent, requirementMatch, total, classification: classify(total), reasons };
}
