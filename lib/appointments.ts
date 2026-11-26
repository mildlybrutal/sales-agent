import { db } from "@/lib/db";
import {
  MAX_BOOKING_DAYS_AHEAD,
  VISIT_DURATION_MIN,
  VISIT_SLOT_HOURS,
  addDays,
  istParts,
  istToDate,
  slotTime,
  weekdayOf,
} from "@/lib/time";

export interface Slot {
  date: string; // YYYY-MM-DD (IST)
  time: string; // HH:mm (IST)
  startsAt: Date;
}

export type SlotProblem =
  | "invalid_time"
  | "in_past"
  | "sunday"
  | "outside_hours"
  | "too_far_ahead";

/** Validate that a requested IST date/time is a bookable slot boundary. */
export function validateSlot(date: string, time: string, now = new Date()): SlotProblem | null {
  const startsAt = istToDate(date, time);
  if (Number.isNaN(startsAt.getTime())) return "invalid_time";
  const [hh, mm] = time.split(":").map(Number);
  if (mm !== 0 || !VISIT_SLOT_HOURS.includes(hh)) return "outside_hours";
  if (weekdayOf(date) === 0) return "sunday";
  if (startsAt.getTime() <= now.getTime() + 30 * 60_000) return "in_past"; // need ≥30 min notice
  if (startsAt.getTime() > now.getTime() + MAX_BOOKING_DAYS_AHEAD * 86_400_000) return "too_far_ahead";
  return null;
}

export const SLOT_PROBLEM_TEXT: Record<SlotProblem, string> = {
  invalid_time: "The date or time could not be understood.",
  in_past: "That time has already passed (visits need at least 30 minutes' notice).",
  sunday: "Site visits are not available on Sundays.",
  outside_hours: "Visits start on the hour between 10:00 and 17:00 IST.",
  too_far_ahead: `Visits can be booked at most ${MAX_BOOKING_DAYS_AHEAD} days ahead.`,
};

/** Start times already taken for a property within [from, to). */
async function takenStarts(propertyId: string, from: Date, to: Date) {
  const rows = await db.appointment.findMany({
    where: { propertyId, status: "CONFIRMED", startsAt: { gte: from, lt: to } },
    select: { startsAt: true },
  });
  return new Set(rows.map((r) => r.startsAt.getTime()));
}

export async function isSlotFree(propertyId: string, startsAt: Date) {
  const clash = await db.appointment.findFirst({
    where: { propertyId, status: "CONFIRMED", startsAt },
    select: { id: true },
  });
  return !clash;
}

/** Free slots on a single IST date. */
export async function freeSlotsOn(propertyId: string, date: string, now = new Date()): Promise<Slot[]> {
  const from = istToDate(date, "00:00");
  const to = istToDate(addDays(date, 1), "00:00");
  const taken = await takenStarts(propertyId, from, to);
  return VISIT_SLOT_HOURS.map((h) => slotTime(h))
    .filter((t) => validateSlot(date, t, now) === null)
    .map((t) => ({ date, time: t, startsAt: istToDate(date, t) }))
    .filter((s) => !taken.has(s.startsAt.getTime()));
}

/** Up to `count` nearest free slots starting from `date` (inclusive), nearest to preferred hour first. */
export async function suggestAlternatives(propertyId: string, date: string, preferredTime?: string, count = 3, now = new Date()) {
  const prefHour = preferredTime ? Number(preferredTime.slice(0, 2)) : 11;
  const out: Slot[] = [];
  const today = istParts(now).date;
  let d = date < today ? today : date;
  for (let i = 0; i < 14 && out.length < count; i++, d = addDays(d, 1)) {
    const free = await freeSlotsOn(propertyId, d, now);
    free.sort((a, b) => Math.abs(Number(a.time.slice(0, 2)) - prefHour) - Math.abs(Number(b.time.slice(0, 2)) - prefHour));
    out.push(...free.slice(0, count - out.length));
  }
  return out;
}

export function slotKeys(propertyId: string, customerId: string, startsAt: Date) {
  const iso = startsAt.toISOString();
  return { propertySlotKey: `${propertyId}|${iso}`, customerSlotKey: `${customerId}|${iso}` };
}

export function endsAtFor(startsAt: Date) {
  return new Date(startsAt.getTime() + VISIT_DURATION_MIN * 60_000);
}
