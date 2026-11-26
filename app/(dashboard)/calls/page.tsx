import Link from "next/link";
import { Suspense } from "react";
import { PageBody, PageHeader } from "@/components/dashboard/page-header";
import { ClassificationBadge, DemoBadge, SentimentBadge, StatusBadge } from "@/components/dashboard/badges";
import { ScopeFilter } from "@/components/dashboard/scope-filter";
import { TableSkeleton } from "@/components/dashboard/loading";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getCalls, parseScope } from "@/lib/queries";
import { formatDuration } from "@/lib/format";
import { formatIST } from "@/lib/time";

export const metadata = { title: "Call History" };

export default function CallsPage({ searchParams }: PageProps<"/calls">) {
  return (
    <>
      <PageHeader title="Call History" description="Every voice conversation with its AI-generated summary and outcome" />
      <PageBody>
        <Suspense fallback={<TableSkeleton />}>
          <Calls searchParams={searchParams} />
        </Suspense>
      </PageBody>
    </>
  );
}

async function Calls({ searchParams }: { searchParams: PageProps<"/calls">["searchParams"] }) {
  const scope = parseScope((await searchParams).data);
  const calls = await getCalls(scope);
  return (
    <>
      <div className="flex justify-end"><ScopeFilter scope={scope} basePath="/calls" /></div>
      <div className="overflow-hidden rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Started (IST)</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead className="w-[40%]">Summary</TableHead>
              <TableHead>Outcome</TableHead>
              <TableHead>Sentiment</TableHead>
              <TableHead className="pr-4">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {calls.length === 0 && (
              <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">No calls yet.</TableCell></TableRow>
            )}
            {calls.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="pl-4 whitespace-nowrap">
                  <Link href={`/calls/${c.id}`} className="font-medium hover:underline">{formatIST(c.startedAt)}</Link>
                </TableCell>
                <TableCell>
                  <div>{c.customer.name ?? "Unknown caller"}</div>
                  <DemoBadge isDemo={c.isDemo} />
                </TableCell>
                <TableCell className="tabular-nums">{formatDuration(c.durationSec)}</TableCell>
                <TableCell className="text-sm whitespace-normal text-muted-foreground">
                  <span className="line-clamp-2">{c.summary?.summary ?? (c.status === "ACTIVE" ? "Call in progress or abandoned — open to summarise." : "No summary")}</span>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col items-start gap-1">
                    <ClassificationBadge value={c.summary?.leadClassification ?? c.customer.lead?.classification} />
                    {c._count.appointments > 0 && <span className="text-xs text-muted-foreground">Visit booked</span>}
                  </div>
                </TableCell>
                <TableCell><SentimentBadge value={c.sentiment} /></TableCell>
                <TableCell className="pr-4"><StatusBadge value={c.status} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
