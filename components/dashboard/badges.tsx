import { cn } from "@/lib/utils";

const tone = {
  red: "bg-red-50 text-red-700 ring-red-600/15",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/20",
  slate: "bg-slate-100 text-slate-700 ring-slate-500/15",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/15",
  blue: "bg-blue-50 text-blue-700 ring-blue-600/15",
  violet: "bg-violet-50 text-violet-700 ring-violet-600/15",
} as const;

function Pill({ color, children, className }: { color: keyof typeof tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap", tone[color], className)}>
      {children}
    </span>
  );
}

export function ClassificationBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return <Pill color={value === "HOT" ? "red" : value === "WARM" ? "amber" : "slate"}>{value}</Pill>;
}

export function SentimentBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-xs text-muted-foreground">Not analysed</span>;
  return <Pill color={value === "POSITIVE" ? "green" : value === "NEGATIVE" ? "red" : "slate"}>{value[0] + value.slice(1).toLowerCase()}</Pill>;
}

export function StatusBadge({ value }: { value: string }) {
  const color = value === "CONFIRMED" ? "blue" : value === "COMPLETED" ? "green" : value === "CANCELLED" ? "slate" : value === "ACTIVE" ? "amber" : value === "VISIT_BOOKED" ? "violet" : "slate";
  return <Pill color={color}>{value.replace("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</Pill>;
}

/** Marks seeded demo rows so they're never confused with records from real calls. */
export function DemoBadge({ isDemo }: { isDemo: boolean }) {
  return isDemo ? (
    <span className="rounded border border-dashed border-muted-foreground/40 px-1.5 py-px text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
      Demo
    </span>
  ) : (
    <span className="rounded bg-foreground px-1.5 py-px text-[10px] font-medium tracking-wide text-background uppercase">Live</span>
  );
}

export function ScoreBar({ score }: { score: number }) {
  const color = score >= 75 ? "bg-red-500" : score >= 45 ? "bg-amber-500" : "bg-slate-400";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${score}%` }} />
      </div>
      <span className="text-sm tabular-nums">{score}</span>
    </div>
  );
}
