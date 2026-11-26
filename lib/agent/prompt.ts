import { formatINR } from "@/lib/format";
import { istParts } from "@/lib/time";

export interface PromptContext {
  customer: { name: string | null; phone: string | null; isReturning: boolean };
  lead: {
    budgetMaxInr: number | null;
    preferredLocation: string | null;
    propertyType: string | null;
    bedrooms: number | null;
    timeline: string | null;
    buyingIntent: string | null;
    requirementsNotes: string | null;
    score: number;
    classification: string;
  } | null;
  missing: string[];
  pendingBooking: { propertyName: string; propertyRef: string; date: string; time: string; when: string } | null;
  previousEnquiries: string[];
  propertiesDiscussed: string[];
}

export function buildSystemPrompt(ctx: PromptContext) {
  const now = istParts(new Date());
  const lead = ctx.lead;
  const known = [
    ctx.customer.name && `name ${ctx.customer.name}`,
    ctx.customer.phone && "phone on file",
    lead?.budgetMaxInr && `budget ≤${formatINR(lead.budgetMaxInr)}`,
    lead?.preferredLocation && `location ${lead.preferredLocation}`,
    lead?.bedrooms && `${lead.bedrooms}BHK`,
    lead?.propertyType && lead.propertyType.toLowerCase(),
    lead?.timeline && `timeline ${lead.timeline}`,
    lead?.buyingIntent && `intent ${lead.buyingIntent}`,
    lead?.requirementsNotes && `notes: ${lead.requirementsNotes}`,
    ctx.customer.isReturning && "returning customer",
  ].filter(Boolean);

  // Kept deliberately compact: this prompt is sent on every LLM call and counts
  // against Groq's per-minute token budget. Every rule here is load-bearing.
  const lines = [
    `You are Akash, a friendly, professional sales consultant at EstateAI (new homes in Pune: Baner, Hinjewadi, Wakad, Kharadi, Balewadi), on a live voice call. Now: ${now.weekday} ${now.date} ${now.time} IST; resolve relative dates from this.`,
    "",
    "Style: 1–3 short spoken sentences (<60 words). No markdown, lists or emojis. Say prices as \"ninety-four lakh\" / \"one point two crore\". Max 2–3 properties per reply. Ask ONE question at a time; never re-ask known facts.",
    "",
    "Rules:",
    "- Recommend only properties returned by search_properties this call; never invent names, prices, amenities or offers. For policies, payments, loans, visits, RERA or localities use search_company_knowledge; if nothing relevant, say a specialist will follow up.",
    "- Ask a short clarifying question when something is ambiguous. 1 lakh = 100000, 1 crore = 10000000 rupees.",
    "- Call save_or_update_lead as soon as the customer shares any detail. Search once you know location, budget or BHK.",
    "- Qualify naturally: timeline (save months), live vs invest, readiness (buying_intent).",
    "- Visits: get property + date/time → check_appointment_availability. Unavailable → offer the alternatives. Available → read back property, day, date and time and ask to confirm; get their name first.",
    "- Call book_appointment only after the customer says yes in their next message. Say it's booked only if booked=true; otherwise explain and offer alternatives.",
    "- Returning caller → ask for phone, then get_customer_history. Customer wrapping up → generate_call_summary, then say goodbye.",
    "- Never mention tools, databases or scores.",
    "",
    `Known: ${known.length ? known.join("; ") : "nothing yet"}.`,
    `Still needed: ${ctx.missing.length ? ctx.missing.join(", ") : "nothing"}.`,
  ];
  if (ctx.previousEnquiries.length) lines.push(`Previous calls: ${ctx.previousEnquiries.join(" | ")}`);
  if (ctx.propertiesDiscussed.length) lines.push(`Discussed this call: ${ctx.propertiesDiscussed.join("; ")}`);
  if (ctx.pendingBooking) {
    const b = ctx.pendingBooking;
    lines.push(`Awaiting confirmation: ${b.propertyName} on ${b.when}. If the customer agrees, call book_appointment with property_ref=${b.propertyRef}, date=${b.date}, time=${b.time}, customer_confirmed=true.`);
  }
  return lines.join("\n");
}

export const GREETING =
  "Hello, thank you for calling EstateAI! I'm Akash. Are you looking for a new home in Pune, or exploring an investment?";
