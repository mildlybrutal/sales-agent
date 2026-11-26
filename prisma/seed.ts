/**
 * Seed: inventory + knowledge base (embedded) + clearly-flagged demo CRM data.
 *
 * Every demo Customer / Lead / Conversation / Appointment has isDemo = true and
 * the dashboard labels them "Demo". Re-running the seed deletes and recreates
 * demo rows only; records created by real calls are never touched.
 */
import "dotenv/config";
import { db } from "../lib/db";
import { recomputeLeadScore } from "../lib/leads";
import { endsAtFor, slotKeys } from "../lib/appointments";
import { addDays, istParts, istToDate, weekdayOf } from "../lib/time";
import { formatINR } from "../lib/format";
import { rebuildKnowledgeBase, upsertProperties } from "./knowledge";
import type { BuyingIntent, PropertyType, Sentiment } from "../lib/generated/prisma/enums";

interface DemoLead {
  name: string;
  phone: string;
  budgetMaxInr: number;
  preferredLocation: string;
  propertyType: PropertyType;
  bedrooms: number;
  timeline: string;
  timelineMonths: number;
  buyingIntent: BuyingIntent;
  notes?: string;
  sentiment: Sentiment;
  daysAgo: number;
  durationSec: number;
  discussed: string[];
  visit?: { slug: string; daysFromNow: number; hour: number; completed?: boolean };
  transcript: [string, string][];
  summary: string;
  followUps: string[];
}

const L = 100_000;
const CR = 10_000_000;

const DEMO: DemoLead[] = [
  {
    name: "Rohan Kulkarni", phone: "+919820011001", budgetMaxInr: 1 * CR, preferredLocation: "Baner", propertyType: "APARTMENT", bedrooms: 3,
    timeline: "within 2 months", timelineMonths: 2, buyingIntent: "HIGH", sentiment: "POSITIVE", daysAgo: 1, durationSec: 312,
    discussed: ["skyline-residences-baner", "baner-greens"], visit: { slug: "skyline-residences-baner", daysFromNow: 2, hour: 16 },
    transcript: [
      ["Hi, I'm looking for a 3BHK in Baner, budget around one crore.", "Great choice! Skyline Residences has ready-to-move 3BHKs at ninety-four lakh, and Baner Greens offers 3BHKs at eighty-eight lakh with possession in 2027. When are you planning to buy?"],
      ["Within two months, we want to move before school starts.", "Then Skyline Residences fits well since it's ready to move. Would you like to visit this week?"],
      ["Yes, Saturday afternoon works.", "I've booked your visit to Skyline Residences on Saturday at 4 PM. See you then!"],
    ],
    summary: "Rohan wants a ready-to-move 3BHK in Baner under ₹1 Cr within two months for his family. Skyline Residences and Baner Greens were presented; he preferred Skyline for immediate possession and booked a site visit.",
    followUps: ["Share Skyline Residences cost sheet before the visit", "Arrange home-loan pre-approval call", "Confirm visit the day before"],
  },
  {
    name: "Priya Deshmukh", phone: "+919820011002", budgetMaxInr: 75 * L, preferredLocation: "Hinjewadi", propertyType: "APARTMENT", bedrooms: 2,
    timeline: "in 3 months", timelineMonths: 3, buyingIntent: "HIGH", notes: "Investment; wants rental yield", sentiment: "POSITIVE", daysAgo: 2, durationSec: 248,
    discussed: ["tech-park-towers-hinjewadi"], visit: { slug: "tech-park-towers-hinjewadi", daysFromNow: -1, hour: 11, completed: true },
    transcript: [
      ["I want a 2BHK in Hinjewadi to rent out to IT folks.", "Tech Park Towers in Hinjewadi Phase 1 is a ready 2BHK at seventy-two lakh with about 3.5 percent rental yield. What's your timeline?"],
      ["About three months.", "Perfect. Shall I arrange a site visit?"],
    ],
    summary: "Priya is an investor seeking a 2BHK in Hinjewadi under ₹75 L for rental income within three months. Tech Park Towers matched; a site visit was completed.",
    followUps: ["Send rental-yield comparison", "Follow up on booking decision after visit"],
  },
  {
    name: "Amit Shah", phone: "+919820011003", budgetMaxInr: 130 * L, preferredLocation: "Kharadi", propertyType: "APARTMENT", bedrooms: 3,
    timeline: "6 months", timelineMonths: 6, buyingIntent: "MEDIUM", sentiment: "NEUTRAL", daysAgo: 3, durationSec: 205,
    discussed: ["kharadi-bay"],
    transcript: [
      ["Do you have 3BHKs in Kharadi?", "Yes, Kharadi Bay has ready 3BHKs at one point two five crore, close to the IT district. When are you looking to buy?"],
      ["Maybe in six months, still comparing.", "Understood. I can share details and we can plan a visit whenever you're ready."],
    ],
    summary: "Amit is comparing 3BHK options in Kharadi with a ₹1.3 Cr budget and a six-month horizon. Kharadi Bay was presented. No visit booked yet.",
    followUps: ["Email Kharadi Bay brochure", "Check back in 3 weeks"],
  },
  {
    name: "Sneha Patil", phone: "+919820011004", budgetMaxInr: 60 * L, preferredLocation: "Baner", propertyType: "APARTMENT", bedrooms: 3,
    timeline: "next year", timelineMonths: 14, buyingIntent: "LOW", sentiment: "NEGATIVE", daysAgo: 4, durationSec: 141,
    discussed: [],
    transcript: [
      ["I need a 3BHK in Baner for sixty lakh.", "Our 3BHKs in Baner start at eighty-eight lakh. Would you consider a 2BHK, or Wakad, where prices are lower?"],
      ["That's too expensive. I'll look elsewhere.", "I understand. I'll keep you posted if anything in your budget comes up."],
    ],
    summary: "Sneha wants a 3BHK in Baner for ₹60 L, below current inventory. She was unhappy with pricing and declined alternatives.",
    followUps: ["Add to new-launch alerts for Baner", "Low priority — revisit in 6 months"],
  },
  {
    name: "Vikram Joshi", phone: "+919820011005", budgetMaxInr: 320 * L, preferredLocation: "Kharadi", propertyType: "VILLA", bedrooms: 4,
    timeline: "within a month", timelineMonths: 1, buyingIntent: "HIGH", notes: "Wants private pool", sentiment: "POSITIVE", daysAgo: 5, durationSec: 377,
    discussed: ["kharadi-signature-villas"], visit: { slug: "kharadi-signature-villas", daysFromNow: 3, hour: 11 },
    transcript: [
      ["Looking for a villa with a private pool in East Pune.", "Kharadi Signature Villas are 4BHK villas with private pools at three point one crore, ready to move. When would you like to buy?"],
      ["As soon as possible, this month.", "Wonderful. Let's get you a site visit — I've booked it for you."],
    ],
    summary: "Vikram is a high-intent buyer for a 4BHK villa with private pool in Kharadi, budget ₹3.2 Cr, buying within a month. Site visit booked at Kharadi Signature Villas.",
    followUps: ["Assign senior relationship manager", "Prepare negotiation range with developer"],
  },
  {
    name: "Neha Iyer", phone: "+919820011006", budgetMaxInr: 95 * L, preferredLocation: "Balewadi", propertyType: "APARTMENT", bedrooms: 2,
    timeline: "4 months", timelineMonths: 4, buyingIntent: "MEDIUM", sentiment: "POSITIVE", daysAgo: 6, durationSec: 263,
    discussed: ["balewadi-highstreet-residences"],
    transcript: [
      ["Anything near Balewadi High Street?", "Balewadi Highstreet Residences has ready 2BHKs at ninety-two lakh, right on the High Street. When are you planning to purchase?"],
      ["Around four months.", "Great, I'll share the details and we can schedule a visit."],
    ],
    summary: "Neha likes the Balewadi High Street lifestyle and is considering a 2BHK under ₹95 L within four months. Balewadi Highstreet Residences was presented.",
    followUps: ["Send floor plans", "Offer weekend visit slot"],
  },
  {
    name: "Arjun Mehta", phone: "+919820011007", budgetMaxInr: 80 * L, preferredLocation: "Wakad", propertyType: "APARTMENT", bedrooms: 2,
    timeline: "9 months", timelineMonths: 9, buyingIntent: "MEDIUM", sentiment: "NEUTRAL", daysAgo: 8, durationSec: 190,
    discussed: ["wakad-central"],
    transcript: [
      ["First-time buyer, looking at Wakad 2BHKs.", "Wakad Central offers 2BHKs at seventy-eight lakh with possession in March 2027. What timeline are you considering?"],
      ["Probably later this year.", "No problem, I'll send you the payment plan details."],
    ],
    summary: "Arjun is a first-time buyer exploring 2BHKs in Wakad under ₹80 L with a nine-month timeline. Wakad Central was discussed.",
    followUps: ["Share construction-linked payment plan", "Invite to home-loan webinar"],
  },
  {
    name: "Kavya Rao", phone: "+919820011008", budgetMaxInr: 50 * L, preferredLocation: "Kharadi", propertyType: "APARTMENT", bedrooms: 1,
    timeline: "2 months", timelineMonths: 2, buyingIntent: "HIGH", sentiment: "POSITIVE", daysAgo: 10, durationSec: 222,
    discussed: ["kharadi-urban-nest"], visit: { slug: "kharadi-urban-nest", daysFromNow: -4, hour: 15, completed: true },
    transcript: [
      ["I want a 1BHK in Kharadi under fifty lakh.", "Kharadi Urban Nest has 1BHKs at forty-eight lakh, possession September 2027. When are you planning to buy?"],
      ["Within two months.", "Let's book a site visit then."],
    ],
    summary: "Kavya, a young professional, wants a 1BHK in Kharadi under ₹50 L within two months. Visited Kharadi Urban Nest.",
    followUps: ["Send booking form", "Share furnished-unit options"],
  },
];

/** Next Mon–Sat date `days` from today (IST), skipping Sundays forward. */
function workingDay(days: number) {
  let d = addDays(istParts(new Date()).date, days);
  while (weekdayOf(d) === 0) d = addDays(d, days >= 0 ? 1 : -1);
  return d;
}

async function seedDemoData() {
  await db.customer.deleteMany({ where: { isDemo: true } });
  const props = new Map((await db.property.findMany()).map((p) => [p.slug, p]));

  for (const d of DEMO) {
    const startedAt = new Date(Date.now() - d.daysAgo * 86_400_000 - Math.floor(Math.random() * 6) * 3_600_000);
    const customer = await db.customer.create({
      data: {
        name: d.name, phone: d.phone, isDemo: true, createdAt: startedAt,
        lead: {
          create: {
            budgetMaxInr: d.budgetMaxInr, preferredLocation: d.preferredLocation, propertyType: d.propertyType, bedrooms: d.bedrooms,
            timeline: d.timeline, timelineMonths: d.timelineMonths, buyingIntent: d.buyingIntent, requirementsNotes: d.notes,
            sentiment: d.sentiment, isDemo: true, createdAt: startedAt,
          },
        },
      },
    });
    const conv = await db.conversation.create({
      data: {
        customerId: customer.id, status: "ENDED", consentGivenAt: startedAt, startedAt,
        endedAt: new Date(startedAt.getTime() + d.durationSec * 1000), durationSec: d.durationSec,
        sentiment: d.sentiment, turnCount: d.transcript.length, isDemo: true,
        propertiesDiscussed: d.discussed.map((s) => props.get(s)!.id),
      },
    });
    let t = startedAt.getTime();
    for (const [i, [user, agent]] of d.transcript.entries()) {
      await db.message.create({ data: { conversationId: conv.id, role: "USER", content: user, turnIndex: i + 1, createdAt: new Date((t += 15_000)) } });
      await db.message.create({ data: { conversationId: conv.id, role: "ASSISTANT", content: agent, turnIndex: i + 1, createdAt: new Date((t += 5_000)) } });
    }

    let appointment = null;
    if (d.visit) {
      const p = props.get(d.visit.slug)!;
      const startsAt = istToDate(workingDay(d.visit.daysFromNow), `${String(d.visit.hour).padStart(2, "0")}:00`);
      const completed = Boolean(d.visit.completed);
      appointment = await db.appointment.create({
        data: {
          customerId: customer.id, propertyId: p.id, conversationId: conv.id, startsAt, endsAt: endsAtFor(startsAt),
          status: completed ? "COMPLETED" : "CONFIRMED", isDemo: true,
          ...(completed ? {} : slotKeys(p.id, customer.id, startsAt)),
        },
      });
    }

    const breakdown = await recomputeLeadScore(customer.id);
    await db.callSummary.create({
      data: {
        conversationId: conv.id,
        customerRequirements: {
          name: d.name, budget: formatINR(d.budgetMaxInr), budgetMaxInr: d.budgetMaxInr, preferredLocation: d.preferredLocation,
          bedrooms: d.bedrooms, propertyType: d.propertyType, timeline: d.timeline, buyingIntent: d.buyingIntent, notes: d.notes ?? null,
        },
        summary: d.summary,
        leadScore: breakdown!.total,
        leadClassification: breakdown!.classification,
        sentiment: d.sentiment,
        sentimentReason: "Seeded demo record.",
        propertiesDiscussed: d.discussed.map((s) => ({ id: props.get(s)!.id, name: props.get(s)!.name, location: props.get(s)!.location, price: formatINR(props.get(s)!.priceInr) })),
        appointmentDetails: appointment ? { id: appointment.id, property: props.get(d.visit!.slug)!.name, startsAt: appointment.startsAt.toISOString(), status: appointment.status } : undefined,
        followUpRecommendations: d.followUps,
        createdAt: new Date(t),
      },
    });
  }
  return DEMO.length;
}

async function main() {
  console.log(`Properties upserted: ${await upsertProperties()}`);
  const t = Date.now();
  const kb = await rebuildKnowledgeBase();
  console.log(`Knowledge base: ${kb.documents} documents → ${kb.chunks} embedded chunks (${Date.now() - t} ms)`);
  console.log(`Demo customers seeded: ${await seedDemoData()} (isDemo = true)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
