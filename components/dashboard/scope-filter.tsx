import Link from "next/link";
import { cn } from "@/lib/utils";
import type { DataScope } from "@/lib/queries";

/** Toggle between all records, live (agent-generated) records and seeded demo data. */
export function ScopeFilter({ scope, basePath, extra = {} }: { scope: DataScope; basePath: string; extra?: Record<string, string | undefined> }) {
  const opts: { v: DataScope; label: string }[] = [
    { v: "all", label: "All" },
    { v: "live", label: "Live calls" },
    { v: "demo", label: "Demo data" },
  ];
  return (
    <div className="inline-flex rounded-md border bg-background p-0.5 text-sm">
      {opts.map((o) => {
        const params = new URLSearchParams(Object.entries({ ...extra, data: o.v === "all" ? undefined : o.v }).filter(([, v]) => v) as [string, string][]);
        const qs = params.toString();
        return (
          <Link
            key={o.v}
            href={`${basePath}${qs ? `?${qs}` : ""}`}
            className={cn("rounded px-2.5 py-1 font-medium", scope === o.v ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
          >
            {o.label}
          </Link>
        );
      })}
    </div>
  );
}
