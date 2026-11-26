/** Read-only queries for the dashboard (Server Components only). */
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";

export type DataScope = "all" | "live" | "demo";

export function parseScope(v: string | string[] | undefined): DataScope {
  return v === "live" || v === "demo" ? v : "all";
}

const demoWhere = (scope: DataScope) => (scope === "all" ? {} : { isDemo: scope === "demo" });

export async function getOverview(scope: DataScope) {
  const w = demoWhere(scope);
  const [totalCalls, totalLeads, hotLeads, appointmentsBooked, leadsWithVisit, byClass, bySentiment, recentCalls, recentAppts] = await Promise.all([
    db.conversation.count({ where: w }),
    db.lead.count({ where: { ...w, customer: { conversations: { some: {} } } } }),
    db.lead.count({ where: { ...w, classification: "HOT", customer: { conversations: { some: {} } } } }),
    db.appointment.count({ where: { ...w, status: { in: ["CONFIRMED", "COMPLETED"] } } }),
    db.lead.count({ where: { ...w, customer: { appointments: { some: { status: { in: ["CONFIRMED", "COMPLETED"] } } } } } }),
    db.lead.groupBy({ by: ["classification"], where: { ...w, customer: { conversations: { some: {} } } }, _count: true }),
    db.conversation.groupBy({ by: ["sentiment"], where: w, _count: true }),
    db.conversation.findMany({ where: w, orderBy: { startedAt: "desc" }, take: 6, include: { customer: { include: { lead: true } }, summary: { select: { id: true } } } }),
    db.appointment.findMany({ where: w, orderBy: { createdAt: "desc" }, take: 6, include: { customer: true, property: true } }),
  ]);

  const activity = [
    ...recentCalls.map((c) => ({ kind: "call" as const, at: c.startedAt, id: c.id, isDemo: c.isDemo, customer: c.customer.name, classification: c.customer.lead?.classification, status: c.status })),
    ...recentAppts.map((a) => ({ kind: "appointment" as const, at: a.createdAt, id: a.id, isDemo: a.isDemo, customer: a.customer.name, property: a.property.name, startsAt: a.startsAt, status: a.status })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 8);

  const classCount = (k: string) => byClass.find((x) => x.classification === k)?._count ?? 0;
  const sentCount = (k: string | null) => bySentiment.find((x) => x.sentiment === k)?._count ?? 0;

  return {
    totalCalls,
    totalLeads,
    hotLeads,
    appointmentsBooked,
    conversionRate: totalLeads ? Math.round((leadsWithVisit / totalLeads) * 100) : 0,
    leadDistribution: [
      { name: "Hot", key: "HOT", value: classCount("HOT") },
      { name: "Warm", key: "WARM", value: classCount("WARM") },
      { name: "Cold", key: "COLD", value: classCount("COLD") },
    ],
    sentimentDistribution: [
      { name: "Positive", key: "POSITIVE", value: sentCount("POSITIVE") },
      { name: "Neutral", key: "NEUTRAL", value: sentCount("NEUTRAL") },
      { name: "Negative", key: "NEGATIVE", value: sentCount("NEGATIVE") },
      { name: "Not analysed", key: "NONE", value: sentCount(null) },
    ],
    activity,
  };
}

export async function getLeads(scope: DataScope, classification?: string) {
  const where: Prisma.LeadWhereInput = {
    ...demoWhere(scope),
    customer: { conversations: { some: {} } },
    ...(classification === "HOT" || classification === "WARM" || classification === "COLD" ? { classification } : {}),
  };
  return db.lead.findMany({
    where,
    orderBy: [{ score: "desc" }, { updatedAt: "desc" }],
    include: {
      customer: {
        include: {
          _count: { select: { conversations: true, appointments: true } },
          conversations: { orderBy: { startedAt: "desc" }, take: 1, select: { startedAt: true } },
        },
      },
    },
  });
}

export async function getLead(id: string) {
  return db.lead.findUnique({
    where: { id },
    include: {
      customer: {
        include: {
          conversations: { orderBy: { startedAt: "desc" }, include: { summary: true, messages: { where: { role: { in: ["USER", "ASSISTANT"] }, content: { not: "" } }, orderBy: { createdAt: "asc" } } } },
          appointments: { orderBy: { startsAt: "desc" }, include: { property: true } },
        },
      },
    },
  });
}

export async function getAppointments(scope: DataScope) {
  const now = new Date();
  const include = { customer: { include: { lead: true } }, property: true } as const;
  const [upcoming, past] = await Promise.all([
    db.appointment.findMany({ where: { ...demoWhere(scope), startsAt: { gte: now }, status: "CONFIRMED" }, orderBy: { startsAt: "asc" }, include }),
    db.appointment.findMany({ where: { ...demoWhere(scope), OR: [{ startsAt: { lt: now } }, { status: { not: "CONFIRMED" } }] }, orderBy: { startsAt: "desc" }, take: 50, include }),
  ]);
  return { upcoming, past };
}

export async function getCalls(scope: DataScope) {
  return db.conversation.findMany({
    where: demoWhere(scope),
    orderBy: { startedAt: "desc" },
    take: 100,
    include: { customer: { include: { lead: true } }, summary: true, _count: { select: { appointments: true } } },
  });
}

export async function getCall(id: string) {
  return db.conversation.findUnique({
    where: { id },
    include: {
      customer: { include: { lead: true } },
      summary: true,
      messages: { orderBy: { createdAt: "asc" } },
      appointments: { include: { property: true } },
    },
  });
}
