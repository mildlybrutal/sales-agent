import Link from "next/link";
import { Suspense } from "react";
import { PageBody, PageHeader } from "@/components/dashboard/page-header";
import { ClassificationBadge, DemoBadge, ScoreBar, SentimentBadge, StatusBadge } from "@/components/dashboard/badges";
import { ScopeFilter } from "@/components/dashboard/scope-filter";
import { TableSkeleton } from "@/components/dashboard/loading";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getLeads, parseScope } from "@/lib/queries";
import { formatINR } from "@/lib/format";
import { formatISTDate } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata = { title: "Leads" };

export default function LeadsPage({ searchParams }: PageProps<"/leads">) {
  return (
    <>
      <PageHeader title="Leads" description="Customers qualified by the voice agent, ranked by lead score" />
      <PageBody>
        <Suspense fallback={<TableSkeleton />}>
          <LeadsTable searchParams={searchParams} />
        </Suspense>
      </PageBody>
    </>
  );
}

async function LeadsTable({ searchParams }: { searchParams: PageProps<"/leads">["searchParams"] }) {
  const sp = await searchParams;
  const scope = parseScope(sp.data);
  const cls = typeof sp.class === "string" ? sp.class : undefined;
  const leads = await getLeads(scope, cls);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-md border bg-background p-0.5 text-sm">
          {[undefined, "HOT", "WARM", "COLD"].map((c) => (
            <Link
              key={c ?? "all"}
              href={`/leads?${new URLSearchParams(Object.entries({ class: c, data: scope === "all" ? undefined : scope }).filter(([, v]) => v) as [string, string][])}`}
              className={cn("rounded px-2.5 py-1 font-medium", cls === c ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
            >
              {c ? c[0] + c.slice(1).toLowerCase() : "All leads"}
            </Link>
          ))}
        </div>
        <ScopeFilter scope={scope} basePath="/leads" extra={{ class: cls }} />
      </div>
      <div className="overflow-hidden rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Customer</TableHead>
              <TableHead>Budget</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Requirement</TableHead>
              <TableHead>Timeline</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Class</TableHead>
              <TableHead>Sentiment</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead className="pr-4 text-right">Last call</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leads.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="py-10 text-center text-muted-foreground">
                  No leads match this filter.
                </TableCell>
              </TableRow>
            )}
            {leads.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="pl-4">
                  <Link href={`/leads/${l.id}`} className="font-medium hover:underline">
                    {l.customer.name ?? "Unknown caller"}
                  </Link>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    {l.customer.phone ?? "No phone"} <DemoBadge isDemo={l.isDemo} />
                  </div>
                </TableCell>
                <TableCell className="tabular-nums">{formatINR(l.budgetMaxInr)}</TableCell>
                <TableCell>{l.preferredLocation ?? "—"}</TableCell>
                <TableCell className="text-sm">
                  {[l.bedrooms && `${l.bedrooms}BHK`, l.propertyType?.toLowerCase().replace("_", " ")].filter(Boolean).join(" ") || "—"}
                </TableCell>
                <TableCell className="max-w-36 truncate text-sm">{l.timeline ?? "—"}</TableCell>
                <TableCell><ScoreBar score={l.score} /></TableCell>
                <TableCell><ClassificationBadge value={l.classification} /></TableCell>
                <TableCell><SentimentBadge value={l.sentiment} /></TableCell>
                <TableCell><StatusBadge value={l.stage} /></TableCell>
                <TableCell className="pr-4 text-right text-xs text-muted-foreground">
                  {l.customer.conversations[0] ? formatISTDate(l.customer.conversations[0].startedAt) : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
