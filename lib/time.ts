/**
 * All scheduling uses Asia/Kolkata (IST, UTC+05:30). India has no DST, so a
 * fixed offset is exact; we still format with Intl + the IANA zone name.
 */
export const TIMEZONE = "Asia/Kolkata";
const IST_OFFSET = "+05:30";

/** Site visits: Monday–Saturday, 1-hour slots starting 10:00 … 17:00 IST. */
export const VISIT_SLOT_HOURS = [10, 11, 12, 13, 14, 15, 16, 17];
export const VISIT_DURATION_MIN = 60;
export const MAX_BOOKING_DAYS_AHEAD = 60;

/** "2026-11-27" + "11:00" → Date for 11:00 IST that day. */
export function istToDate(date: string, time: string): Date {
  return new Date(`${date}T${time}:00${IST_OFFSET}`);
}

/** Calendar parts of an instant as seen in IST. */
export function istParts(d: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${hour}:${get("minute")}`,
    weekday: get("weekday"),
    hour: Number(hour),
  };
}

export function formatIST(d: Date, opts: Intl.DateTimeFormatOptions = {}) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: TIMEZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    ...opts,
  }).format(d);
}

export function formatISTDate(d: Date) {
  return formatIST(d, { hour: undefined, minute: undefined, hour12: undefined });
}

/** Add whole days to a YYYY-MM-DD string (calendar arithmetic, timezone-free). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
}

export function slotTime(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`;
}
