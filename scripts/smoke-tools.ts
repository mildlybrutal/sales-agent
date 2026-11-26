/**
 * Exercises the backend tool layer for the required demo workflow WITHOUT an
 * LLM: search → save lead → availability → booking guards → booking →
 * duplicate prevention. Creates a real (non-demo) conversation, then deletes it.
 *
 *   npm run test:tools
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { db } from "../lib/db";
import { executeTool, type ToolContext } from "../lib/agent/tools";
import { retrieve } from "../lib/rag";
import { addDays, istParts, weekdayOf } from "../lib/time";

const ok = (label: string) => console.log(`  ✓ ${label}`);

async function main() {
  const customer = await db.customer.create({ data: { lead: { create: {} } } });
  const conv = await db.conversation.create({ data: { customerId: customer.id, consentGivenAt: new Date() } });
  const ctx: ToolContext = { conversationId: conv.id, customerId: customer.id, turnIndex: 1 };
  const run = async (name: string, args: unknown) => {
    const r = await executeTool(name, JSON.stringify(args), ctx);
    return r as typeof r & { result: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };

  try {
    console.log("RAG");
    const kb = await retrieve("can I get a home loan and how much token amount is needed", { limit: 3 });
    assert.equal(kb.method, "vector");
    assert.ok(kb.results.some((r) => /loan|Booking/i.test(r.title)));
    ok(`vector retrieval → ${kb.results.map((r) => `${r.title} (${r.score.toFixed(2)})`).join(", ")}`);

    console.log("search_properties: 3BHK in Baner under 1 Cr");
    const s = await run("search_properties", { location: "Baner", bedrooms: 3, max_price_inr: 10_000_000 });
    assert.ok(s.ok);
    const names = s.result.properties.map((p: { name: string }) => p.name);
    assert.deepEqual(names.sort(), ["Baner Greens", "Skyline Residences"]);
    ok(names.join(", "));

    const bad = await run("search_properties", { bedrooms: "three" });
    assert.equal(bad.ok, false);
    ok("Zod rejects invalid arguments");

    console.log("save_or_update_lead");
    const l1 = await run("save_or_update_lead", { preferred_location: "Baner", bedrooms: 3, budget_max_inr: 10_000_000, property_type: "APARTMENT" });
    ok(`after requirements: ${l1.result.lead_score} ${l1.result.classification}`);
    const l2 = await run("save_or_update_lead", { purchase_timeline: "within 2 months", purchase_timeline_months: 2, buying_intent: "HIGH", name: "Test Caller" });
    assert.equal(l2.result.lead_score, 100);
    assert.equal(l2.result.classification, "HOT");
    ok(`after timeline + intent: ${l2.result.lead_score} ${l2.result.classification}`);

    console.log("appointments");
    let date = addDays(istParts(new Date()).date, 1);
    while (weekdayOf(date) === 0) date = addDays(date, 1);
    const sunday = (() => { let d = date; while (weekdayOf(d) !== 0) d = addDays(d, 1); return d; })();

    const sun = await run("check_appointment_availability", { property_ref: "skyline-residences-baner", date: sunday, time: "11:00" });
    assert.equal(sun.result.available, false);
    ok(`Sunday rejected, alternatives: ${sun.result.alternatives.map((a: { label: string }) => a.label).join(" | ")}`);

    const early = await run("book_appointment", { property_ref: "skyline-residences-baner", date, time: "12:00", customer_confirmed: true });
    assert.equal(early.ok, false);
    ok(`booking without availability check blocked: ${early.result.error}`);

    const avail = await run("check_appointment_availability", { property_ref: "skyline-residences-baner", date, time: "12:00" });
    assert.equal(avail.result.available, true);
    ok(`slot held: ${avail.result.slot}`);

    const sameTurn = await run("book_appointment", { property_ref: "skyline-residences-baner", date, time: "12:00", customer_confirmed: true });
    assert.equal(sameTurn.result.error, "confirmation_required");
    ok("booking in the same turn as the offer blocked (needs customer reply)");

    ctx.turnIndex = 2; // customer said "yes"
    const unconfirmed = await run("book_appointment", { property_ref: "skyline-residences-baner", date, time: "12:00", customer_confirmed: false });
    assert.equal(unconfirmed.ok, false);
    ok("customer_confirmed=false blocked");

    const booked = await run("book_appointment", { property_ref: "skyline-residences-baner", date, time: "12:00", customer_confirmed: true });
    assert.equal(booked.result.booked, true);
    const row = await db.appointment.findUniqueOrThrow({ where: { id: booked.result.appointment_id } });
    ok(`booked & persisted: ${booked.result.when} (${row.status})`);

    const again = await run("book_appointment", { property_ref: "skyline-residences-baner", date, time: "12:00", customer_confirmed: true });
    assert.equal((await db.appointment.count({ where: { customerId: ctx.customerId } })), 1);
    ok(`repeat booking is idempotent: ${again.display}`);

    // Another customer cannot take the same property slot.
    const other = await db.customer.create({ data: { name: "Other", lead: { create: {} } } });
    const otherConv = await db.conversation.create({ data: { customerId: other.id, consentGivenAt: new Date() } });
    const octx: ToolContext = { conversationId: otherConv.id, customerId: other.id, turnIndex: 1 };
    const taken = await executeTool("check_appointment_availability", JSON.stringify({ property_ref: "skyline-residences-baner", date, time: "12:00" }), octx);
    assert.equal((taken.result as { available: boolean }).available, false);
    ok("slot shows as taken for another customer");
    // Race: force the insert past the app-level checks → DB unique constraint must stop it.
    await db.conversation.update({ where: { id: otherConv.id }, data: { pendingBooking: { propertyId: row.propertyId, startsAt: row.startsAt.toISOString(), offeredAtTurn: 0 } } });
    const race = await executeTool("book_appointment", JSON.stringify({ property_ref: "skyline-residences-baner", date, time: "12:00", customer_confirmed: true }), octx);
    assert.equal((race.result as { error: string }).error, "slot_taken");
    ok("DB unique constraint prevents double booking (P2002 → slot_taken)");
    await db.customer.delete({ where: { id: other.id } });

    const lead = await db.lead.findUniqueOrThrow({ where: { customerId: ctx.customerId } });
    assert.equal(lead.stage, "VISIT_BOOKED");
    ok(`lead stage → ${lead.stage}, score ${lead.score}`);

    console.log("\nAll tool-layer checks passed.");
  } finally {
    await db.customer.delete({ where: { id: ctx.customerId } }).catch(() => {});
    await db.customer.delete({ where: { id: customer.id } }).catch(() => {});
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
