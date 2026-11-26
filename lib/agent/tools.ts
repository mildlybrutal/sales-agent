/**
 * Backend tools exposed to the LLM.
 *
 * The LLM never touches the database. It can only *request* one of these
 * tools by name with JSON arguments; every request is validated with Zod and
 * executed by the functions below, which apply business rules (confirmation
 * before booking, duplicate protection, IST-only scheduling, etc.).
 */
import { z } from "zod";
import { db } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { LOCATIONS } from "@/lib/data/properties";
import { retrieve } from "@/lib/rag";
import { recomputeLeadScore, missingQualificationFields } from "@/lib/leads";
import {
  SLOT_PROBLEM_TEXT,
  endsAtFor,
  freeSlotsOn,
  isSlotFree,
  slotKeys,
  suggestAlternatives,
  validateSlot,
} from "@/lib/appointments";
import { formatIST, istParts, istToDate } from "@/lib/time";
import { formatINR } from "@/lib/format";
import { generateCallSummary } from "@/lib/agent/summary";

export interface ToolContext {
  conversationId: string;
  /** May change if save_or_update_lead links the call to a returning customer. */
  customerId: string;
  turnIndex: number;
}

export interface ToolOutcome {
  ok: boolean;
  /** JSON-serialisable payload returned to the LLM. */
  result: unknown;
  /** One-line human summary shown in the UI transcript. */
  display: string;
  /** Side effects the UI cares about. */
  effects?: { appointmentId?: string; summaryGenerated?: boolean; leadUpdated?: boolean };
}

// ---------- shared schemas ----------

const location = z.enum(LOCATIONS);
const propertyType = z.enum(["APARTMENT", "VILLA", "PENTHOUSE", "ROW_HOUSE"]);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:mm");
const propertyRef = z.string().min(3).max(80).describe("The property's `ref` value from search_properties results");

/** LLMs often send null for "not provided"; treat null as absent. */
const opt = <T extends z.ZodTypeAny>(s: T) => s.nullish().transform((v) => v ?? undefined);

function normalisePhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}

async function resolveProperty(ref: string) {
  const isUuid = /^[0-9a-f-]{36}$/i.test(ref);
  return db.property.findFirst({
    where: isUuid ? { id: ref } : { OR: [{ slug: ref }, { name: { equals: ref, mode: "insensitive" } }] },
  });
}

function propertyForLLM(p: {
  slug: string; name: string; location: string; priceInr: number; bedrooms: number; propertyType: string;
  areaSqft: number; amenities: string[]; availability: string; unitsAvailable: number;
}) {
  return {
    ref: p.slug,
    name: p.name,
    location: p.location,
    price: formatINR(p.priceInr),
    price_inr: p.priceInr,
    bedrooms: p.bedrooms,
    type: p.propertyType,
    area_sqft: p.areaSqft,
    amenities: p.amenities,
    availability: p.availability,
    units_available: p.unitsAvailable,
  };
}

// ---------- tool definitions ----------

const searchPropertiesArgs = z.object({
  location: opt(location),
  max_price_inr: opt(z.number().int().positive().describe("Upper budget in rupees. 1 lakh = 100000, 1 crore = 10000000")),
  min_price_inr: opt(z.number().int().positive()),
  bedrooms: opt(z.number().int().min(1).max(6)),
  property_type: opt(propertyType),
  query: opt(z.string().max(300).describe("Free-text description for semantic search, e.g. 'near IT park with pool'")),
  include_sold_out: opt(z.boolean()),
});

const companyKnowledgeArgs = z.object({
  query: z.string().min(2).max(300).describe("Question about EstateAI policies, payments, loans, visits or localities"),
});

const customerHistoryArgs = z.object({
  phone: opt(z.string().max(20).describe("Customer phone number if they gave one; omit to use the current caller")),
});

const saveLeadArgs = z.object({
  name: opt(z.string().min(1).max(80)),
  phone: opt(z.string().max(20)),
  budget_max_inr: opt(z.number().int().positive().describe("Maximum budget in rupees")),
  preferred_location: opt(location),
  property_type: opt(propertyType),
  bedrooms: opt(z.number().int().min(1).max(6)),
  purchase_timeline: opt(z.string().max(80).describe("Customer's words, e.g. 'within 3 months'")),
  purchase_timeline_months: opt(z.number().int().min(0).max(120).describe("Timeline converted to months")),
  buying_intent: opt(z.enum(["HIGH", "MEDIUM", "LOW"]).describe("HIGH = ready to buy/visit soon, MEDIUM = actively exploring, LOW = just browsing")),
  notes: opt(z.string().max(500).describe("Other requirements, e.g. 'needs pet-friendly, near school'")),
});

const checkAvailabilityArgs = z.object({
  property_ref: propertyRef,
  date: isoDate.describe("Visit date YYYY-MM-DD in Asia/Kolkata"),
  time: opt(hhmm.describe("Preferred start time HH:mm (24h, IST). Omit to list all free slots that day.")),
});

const bookAppointmentArgs = z.object({
  property_ref: propertyRef,
  date: isoDate,
  time: hhmm,
  customer_confirmed: z.boolean().describe("true ONLY if the customer explicitly said yes to this exact property, date and time"),
});

const callSummaryArgs = z.object({});

type ToolDef<S extends z.ZodTypeAny> = {
  name: string;
  description: string;
  schema: S;
  run: (args: z.output<S>, ctx: ToolContext) => Promise<ToolOutcome>;
};

function defineTool<S extends z.ZodTypeAny>(t: ToolDef<S>) {
  return t;
}

export const TOOLS = [
  defineTool({
    name: "search_properties",
    description:
      "Search EstateAI's property inventory. Uses exact database filters for location, price, bedrooms and type, and semantic vector search when `query` describes softer preferences. Only properties returned here may be recommended.",
    schema: searchPropertiesArgs,
    async run(args, ctx) {
      const where: Prisma.PropertyWhereInput = {};
      if (args.location) where.location = args.location;
      if (args.bedrooms) where.bedrooms = args.bedrooms;
      if (args.property_type) where.propertyType = args.property_type;
      if (args.max_price_inr || args.min_price_inr) where.priceInr = { lte: args.max_price_inr, gte: args.min_price_inr };
      if (!args.include_sold_out) where.unitsAvailable = { gt: 0 };

      let properties = await db.property.findMany({ where, orderBy: { priceInr: "asc" }, take: 20 });
      let retrievalMethod: string = "sql_filters";

      // Semantic re-ranking of the filtered set for descriptive queries.
      if (args.query && properties.length > 1) {
        const { method, results } = await retrieve(args.query, { limit: 10, sourceTypes: ["PROPERTY_LISTING"] });
        retrievalMethod = `sql_filters+${method}`;
        const rank = new Map<string, number>();
        results.forEach((r) => r.propertyId && !rank.has(r.propertyId) && rank.set(r.propertyId, r.score));
        properties = [...properties].sort((a, b) => (rank.get(b.id) ?? -1) - (rank.get(a.id) ?? -1));
      }
      properties = properties.slice(0, 5);

      // Near-miss suggestions so the agent can offer honest alternatives.
      let alternatives: ReturnType<typeof propertyForLLM>[] = [];
      if (properties.length === 0) {
        const relaxed = await db.property.findMany({
          where: {
            unitsAvailable: { gt: 0 },
            ...(args.location ? { location: args.location } : {}),
          },
          orderBy: { priceInr: "asc" },
          take: 3,
        });
        alternatives = relaxed.map(propertyForLLM);
      }

      if (properties.length) {
        await db.conversation.update({
          where: { id: ctx.conversationId },
          data: { propertiesDiscussed: { push: properties.map((p) => p.id) } },
        });
        // de-duplicate the array
        const conv = await db.conversation.findUnique({ where: { id: ctx.conversationId }, select: { propertiesDiscussed: true } });
        await db.conversation.update({
          where: { id: ctx.conversationId },
          data: { propertiesDiscussed: [...new Set(conv?.propertiesDiscussed ?? [])] },
        });
      }

      return {
        ok: true,
        result: {
          retrieval: retrievalMethod,
          count: properties.length,
          properties: properties.map(propertyForLLM),
          ...(properties.length === 0
            ? { note: "No exact matches. Do not invent properties. You may offer these closest alternatives.", alternatives }
            : {}),
        },
        display: properties.length
          ? `Found ${properties.length}: ${properties.map((p) => p.name).join(", ")}`
          : `No exact matches (${alternatives.length} alternatives)`,
      };
    },
  }),

  defineTool({
    name: "search_company_knowledge",
    description:
      "Semantic search over EstateAI's knowledge base (company info, site-visit policy, booking & payment plans, home loans, RERA, locality guide, listing descriptions). Use for any factual question not answered by search_properties.",
    schema: companyKnowledgeArgs,
    async run(args) {
      const { method, results } = await retrieve(args.query, { limit: 4 });
      return {
        ok: true,
        result: {
          retrieval: method,
          passages: results.map((r) => ({ source: r.title, relevance: Number(r.score.toFixed(3)), text: r.content })),
          ...(results.length === 0 ? { note: "Nothing relevant found. Say you will have a specialist follow up." } : {}),
        },
        display: `${method === "vector" ? "Vector" : "Keyword-fallback"} search: ${results.map((r) => r.title).filter((t, i, a) => a.indexOf(t) === i).join(", ") || "no results"}`,
      };
    },
  }),

  defineTool({
    name: "get_customer_history",
    description:
      "Look up a customer's saved profile, qualification, previous calls and appointments. Call with the phone number when a caller says they've spoken to us before.",
    schema: customerHistoryArgs,
    async run(args, ctx) {
      let customerId = ctx.customerId;
      if (args.phone) {
        const phone = normalisePhone(args.phone);
        if (!phone) return { ok: false, result: { error: "invalid_phone", message: "Ask the customer to repeat their 10-digit mobile number." }, display: "Invalid phone number" };
        const found = await db.customer.findUnique({ where: { phone }, select: { id: true } });
        if (!found) return { ok: true, result: { found: false, message: "No previous record for this number. Treat as a new customer." }, display: "No previous record" };
        customerId = found.id;
      }
      const customer = await db.customer.findUnique({
        where: { id: customerId },
        include: {
          lead: true,
          conversations: {
            where: { id: { not: ctx.conversationId } },
            orderBy: { startedAt: "desc" },
            take: 5,
            include: { summary: true },
          },
          appointments: { orderBy: { startsAt: "desc" }, take: 5, include: { property: true } },
        },
      });
      if (!customer) return { ok: false, result: { error: "not_found" }, display: "Customer not found" };
      return {
        ok: true,
        result: {
          found: true,
          returning_customer: customer.conversations.length > 0,
          name: customer.name,
          phone_on_file: Boolean(customer.phone),
          requirements: customer.lead && {
            budget: formatINR(customer.lead.budgetMaxInr),
            preferred_location: customer.lead.preferredLocation,
            bedrooms: customer.lead.bedrooms,
            property_type: customer.lead.propertyType,
            timeline: customer.lead.timeline,
            lead_classification: customer.lead.classification,
          },
          previous_calls: customer.conversations.map((c) => ({
            date: formatIST(c.startedAt),
            summary: c.summary?.summary ?? "(no summary)",
          })),
          appointments: customer.appointments.map((a) => ({
            property: a.property.name,
            when: formatIST(a.startsAt),
            status: a.status,
          })),
          ...(args.phone && customerId !== ctx.customerId
            ? { note: "This number belongs to an existing customer. Call save_or_update_lead with this phone to link this call to their record." }
            : {}),
        },
        display: customer.conversations.length ? `Returning customer — ${customer.conversations.length} previous call(s)` : "Customer profile loaded",
      };
    },
  }),

  defineTool({
    name: "save_or_update_lead",
    description:
      "Persist anything the customer has told you about themselves or their requirements. Call it as soon as new details are shared (name, phone, budget, location, bedrooms, type, timeline, intent). Returns the deterministic lead score and which qualification fields are still missing.",
    schema: saveLeadArgs,
    async run(args, ctx) {
      let phone: string | undefined;
      if (args.phone) {
        const p = normalisePhone(args.phone);
        if (!p) return { ok: false, result: { error: "invalid_phone", message: "Phone must be a valid 10-digit Indian mobile number. Ask the customer to repeat it." }, display: "Invalid phone number" };
        phone = p;
      }

      const outcome = await db.$transaction(async (tx) => {
        let customerId = ctx.customerId;
        let linkedToExisting = false;

        // Returning customer: re-home this call onto their existing record.
        if (phone) {
          const existing = await tx.customer.findUnique({ where: { phone }, include: { lead: true } });
          if (existing && existing.id !== customerId) {
            const current = await tx.customer.findUniqueOrThrow({ where: { id: customerId }, include: { lead: true } });
            await tx.conversation.updateMany({ where: { customerId }, data: { customerId: existing.id } });
            await tx.appointment.updateMany({ where: { customerId }, data: { customerId: existing.id } });
            if (current.lead) {
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const { id: _id, customerId: _c, createdAt: _ca, updatedAt: _ua, scoreBreakdown: _sb, ...fields } = current.lead;
              const carry = Object.fromEntries(Object.entries(fields).filter(([, v]) => v != null));
              if (existing.lead) await tx.lead.update({ where: { customerId: existing.id }, data: { ...carry, scoreBreakdown: Prisma.DbNull } });
              else await tx.lead.create({ data: { ...(carry as object), customerId: existing.id } });
            }
            await tx.customer.delete({ where: { id: customerId } });
            customerId = existing.id;
            linkedToExisting = true;
          }
        }

        await tx.customer.update({
          where: { id: customerId },
          data: { ...(args.name ? { name: args.name } : {}), ...(phone ? { phone } : {}) },
        });

        const leadData = {
          ...(args.budget_max_inr ? { budgetMaxInr: args.budget_max_inr } : {}),
          ...(args.preferred_location ? { preferredLocation: args.preferred_location } : {}),
          ...(args.property_type ? { propertyType: args.property_type } : {}),
          ...(args.bedrooms ? { bedrooms: args.bedrooms } : {}),
          ...(args.purchase_timeline ? { timeline: args.purchase_timeline } : {}),
          ...(args.purchase_timeline_months != null ? { timelineMonths: args.purchase_timeline_months } : {}),
          ...(args.buying_intent ? { buyingIntent: args.buying_intent } : {}),
          ...(args.notes ? { requirementsNotes: args.notes } : {}),
        };
        await tx.lead.upsert({ where: { customerId }, create: { customerId, ...leadData }, update: leadData });
        const breakdown = await recomputeLeadScore(customerId, tx);
        const customer = await tx.customer.findUniqueOrThrow({ where: { id: customerId }, include: { lead: true } });
        return { customerId, linkedToExisting, breakdown, customer };
      });

      ctx.customerId = outcome.customerId;
      const { breakdown, customer } = outcome;
      return {
        ok: true,
        result: {
          saved: true,
          linked_to_existing_customer: outcome.linkedToExisting,
          lead_score: breakdown?.total,
          classification: breakdown?.classification,
          score_reasons: breakdown?.reasons,
          still_missing: missingQualificationFields(customer.lead!, customer),
        },
        display: `Lead saved · score ${breakdown?.total} (${breakdown?.classification})${outcome.linkedToExisting ? " · linked to returning customer" : ""}`,
        effects: { leadUpdated: true },
      };
    },
  }),

  defineTool({
    name: "check_appointment_availability",
    description:
      "Check site-visit availability for a property on a date (and optionally a time), in Asia/Kolkata. Visits run Mon–Sat, hourly slots 10:00–17:00. If the requested slot is free it is held for confirmation; you must then ask the customer to confirm before calling book_appointment.",
    schema: checkAvailabilityArgs,
    async run(args, ctx) {
      const property = await resolveProperty(args.property_ref);
      if (!property) return { ok: false, result: { error: "unknown_property", message: "Use a `ref` from search_properties." }, display: "Unknown property" };
      if (property.unitsAvailable <= 0) return { ok: false, result: { error: "sold_out", message: `${property.name} is sold out; visits are not offered.` }, display: `${property.name} is sold out` };

      if (!args.time) {
        const free = await freeSlotsOn(property.id, args.date);
        const alternatives = free.length ? [] : await suggestAlternatives(property.id, args.date);
        return {
          ok: true,
          result: {
            property: property.name,
            date: args.date,
            timezone: "Asia/Kolkata",
            free_slots: free.map((s) => s.time),
            ...(free.length ? {} : { message: "No free slots that day.", next_available: alternatives.map((s) => ({ date: s.date, time: s.time, label: formatIST(s.startsAt) })) }),
          },
          display: `${property.name} on ${args.date}: ${free.length} free slot(s)`,
        };
      }

      const problem = validateSlot(args.date, args.time);
      const startsAt = istToDate(args.date, args.time);
      const free = !problem && (await isSlotFree(property.id, startsAt));
      if (!free) {
        const alternatives = await suggestAlternatives(property.id, args.date, args.time);
        return {
          ok: true,
          result: {
            available: false,
            reason: problem ? SLOT_PROBLEM_TEXT[problem] : "That slot is already booked.",
            alternatives: alternatives.map((s) => ({ date: s.date, time: s.time, label: formatIST(s.startsAt) })),
          },
          display: `${args.date} ${args.time} unavailable · ${alternatives.length} alternatives offered`,
        };
      }

      await db.conversation.update({
        where: { id: ctx.conversationId },
        data: { pendingBooking: { propertyId: property.id, startsAt: startsAt.toISOString(), offeredAtTurn: ctx.turnIndex } },
      });
      return {
        ok: true,
        result: {
          available: true,
          property: property.name,
          property_ref: property.slug,
          slot: formatIST(startsAt),
          timezone: "Asia/Kolkata",
          next_step: "Slot is held. Read the property, date and time back to the customer and ask them to confirm. Do NOT book until they say yes.",
        },
        display: `${property.name} · ${formatIST(startsAt)} is available (held for confirmation)`,
      };
    },
  }),

  defineTool({
    name: "book_appointment",
    description:
      "Book a site visit. Only call after check_appointment_availability returned available=true for this exact slot AND the customer has explicitly confirmed in a later message. The customer's name must already be saved. Returns success only if the database confirms the booking.",
    schema: bookAppointmentArgs,
    async run(args, ctx) {
      if (!args.customer_confirmed) {
        return { ok: false, result: { error: "not_confirmed", message: "Ask the customer to confirm the slot first." }, display: "Blocked: customer has not confirmed" };
      }
      const property = await resolveProperty(args.property_ref);
      if (!property) return { ok: false, result: { error: "unknown_property" }, display: "Unknown property" };
      const startsAt = istToDate(args.date, args.time);

      const customer = await db.customer.findUniqueOrThrow({ where: { id: ctx.customerId } });

      // Idempotency: an existing confirmed visit to the same property is returned, not duplicated.
      const existing = await db.appointment.findFirst({
        where: { customerId: customer.id, propertyId: property.id, status: "CONFIRMED", startsAt: { gte: new Date() } },
      });
      if (existing) {
        return {
          ok: existing.startsAt.getTime() === startsAt.getTime(),
          result: {
            error: existing.startsAt.getTime() === startsAt.getTime() ? undefined : "already_booked",
            already_booked: true,
            appointment_id: existing.id,
            when: formatIST(existing.startsAt),
            message: "Customer already has a confirmed visit to this property. Offer to keep it; rescheduling is handled by the office.",
          },
          display: `Existing visit found: ${formatIST(existing.startsAt)}`,
        };
      }

      const conv = await db.conversation.findUniqueOrThrow({ where: { id: ctx.conversationId }, select: { pendingBooking: true } });
      const pending = conv.pendingBooking as { propertyId: string; startsAt: string; offeredAtTurn: number } | null;
      if (!pending || pending.propertyId !== property.id || new Date(pending.startsAt).getTime() !== startsAt.getTime()) {
        return { ok: false, result: { error: "slot_not_checked", message: "Call check_appointment_availability for this exact property, date and time, then ask the customer to confirm." }, display: "Blocked: slot not checked first" };
      }
      // Confirmation must come in a customer turn *after* the slot was offered.
      if (pending.offeredAtTurn >= ctx.turnIndex) {
        return { ok: false, result: { error: "confirmation_required", message: "The slot was only just offered. Ask the customer to confirm and wait for their reply." }, display: "Blocked: waiting for customer confirmation" };
      }

      if (!customer.name) {
        return { ok: false, result: { error: "name_required", message: "Ask for the customer's name and save it with save_or_update_lead before booking." }, display: "Blocked: customer name missing" };
      }

      const problem = validateSlot(args.date, args.time);
      if (problem) return { ok: false, result: { error: problem, message: SLOT_PROBLEM_TEXT[problem] }, display: SLOT_PROBLEM_TEXT[problem] };

      try {
        const appt = await db.$transaction(async (tx) => {
          const a = await tx.appointment.create({
            data: {
              customerId: customer.id,
              propertyId: property.id,
              conversationId: ctx.conversationId,
              startsAt,
              endsAt: endsAtFor(startsAt),
              ...slotKeys(property.id, customer.id, startsAt),
            },
          });
          await tx.conversation.update({ where: { id: ctx.conversationId }, data: { pendingBooking: Prisma.DbNull } });
          await tx.lead.upsert({ where: { customerId: customer.id }, create: { customerId: customer.id }, update: {} });
          await recomputeLeadScore(customer.id, tx);
          return a;
        });
        return {
          ok: true,
          result: {
            booked: true,
            appointment_id: appt.id,
            property: property.name,
            address: property.address,
            when: formatIST(appt.startsAt),
            timezone: "Asia/Kolkata",
          },
          display: `Booked ${property.name} · ${formatIST(appt.startsAt)}`,
          effects: { appointmentId: appt.id, leadUpdated: true },
        };
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          const alternatives = await suggestAlternatives(property.id, args.date, args.time);
          return {
            ok: false,
            result: {
              error: "slot_taken",
              message: "That slot was just taken (or the customer already has a visit at that time). Offer an alternative.",
              alternatives: alternatives.map((s) => ({ date: s.date, time: s.time, label: formatIST(s.startsAt) })),
            },
            display: "Slot no longer available — duplicate prevented",
          };
        }
        throw e;
      }
    },
  }),

  defineTool({
    name: "generate_call_summary",
    description:
      "Generate and save the structured call summary (requirements, lead score, sentiment, properties discussed, appointment, follow-ups). Call once when the customer is wrapping up / saying goodbye.",
    schema: callSummaryArgs,
    async run(_args, ctx) {
      const s = await generateCallSummary(ctx.conversationId);
      return {
        ok: true,
        result: { saved: true, lead_classification: s.leadClassification, sentiment: s.sentiment, instruction: "Thank the customer and say goodbye." },
        display: `Summary saved · ${s.leadClassification} lead · ${s.sentiment.toLowerCase()} sentiment`,
        effects: { summaryGenerated: true },
      };
    },
  }),
];

export type ToolName = (typeof TOOLS)[number]["name"];

/** OpenAI-compatible tool specs, generated from the Zod schemas (single source of truth). */
export function toolSpecs() {
  return TOOLS.map((t) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { $schema: _s, ...parameters } = z.toJSONSchema(t.schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
    return { type: "function" as const, function: { name: t.name, description: t.description, parameters } };
  });
}

export async function executeTool(name: string, rawArgs: string, ctx: ToolContext): Promise<ToolOutcome> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { ok: false, result: { error: "unknown_tool", message: `No tool named ${name}` }, display: `Unknown tool ${name}` };

  let json: unknown;
  try {
    json = rawArgs?.trim() ? JSON.parse(rawArgs) : {};
  } catch {
    return { ok: false, result: { error: "invalid_json", message: "Arguments were not valid JSON." }, display: "Invalid tool arguments" };
  }
  const parsed = tool.schema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      result: { error: "invalid_arguments", issues: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) },
      display: "Rejected invalid arguments",
    };
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await tool.run(parsed.data as any, ctx);
  } catch (e) {
    console.error(`[tool:${name}] failed:`, e instanceof Error ? e.name : "unknown error");
    return { ok: false, result: { error: "tool_failed", message: "Internal error. Apologise and offer a specialist callback." }, display: "Tool error" };
  }
}

/** For the UI: IST "today" so the client can show the agent's date context. */
export function todayIST() {
  return istParts(new Date());
}
