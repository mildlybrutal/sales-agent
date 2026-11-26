import { cn } from "@/lib/utils";

/** Neutral palette with red / amber / green accents only (no blues), light + dark. */
const tone = {
  red: "bg-red-50 text-red-700 ring-red-600/15 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-400/25",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/25",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/15 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-400/25",
  grey: "bg-muted text-muted-foreground ring-border",
  /** Neutral but emphasised: used for "confirmed" states. */
  strong: "bg-background text-foreground ring-foreground/25",
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
  return <Pill color={value === "HOT" ? "red" : value === "WARM" ? "amber" : "grey"}>{value}</Pill>;
}

export function SentimentBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-xs text-muted-foreground">Not analysed</span>;
  return <Pill color={value === "POSITIVE" ? "green" : value === "NEGATIVE" ? "red" : "grey"}>{value[0] + value.slice(1).toLowerCase()}</Pill>;
}

export function StatusBadge({ value }: { value: string }) {
  const color: keyof typeof tone =
    value === "CONFIRMED" ? "strong" : value === "COMPLETED" || value === "VISIT_BOOKED" ? "green" : value === "ACTIVE" ? "amber" : "grey";
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
  const color = score >= 75 ? "bg-[var(--status-hot)]" : score >= 45 ? "bg-[var(--status-warm)]" : "bg-[var(--status-muted)]";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${score}%` }} />
      </div>
      <span className="text-sm tabular-nums">{score}</span>
    </div>
  );
}
