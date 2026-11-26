import Link from "next/link";
import { Suspense } from "react";
import { CalendarCheck, Flame, Mic, Percent, PhoneCall, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageBody, PageHeader } from "@/components/dashboard/page-header";
import { ClassificationBadge, DemoBadge, StatusBadge } from "@/components/dashboard/badges";
import { DistributionChart } from "@/components/dashboard/charts";
import { ScopeFilter } from "@/components/dashboard/scope-filter";
import { StatsSkeleton } from "@/components/dashboard/loading";
import { getOverview, parseScope } from "@/lib/queries";
import { formatIST } from "@/lib/time";

export default function OverviewPage({ searchParams }: PageProps<"/">) {
  return (
    <>
      <PageHeader
        title="Overview"
        description="Voice agent performance and pipeline health"
        actions={
          <Button asChild>
            <Link href="/agent">
              <Mic /> Start a call
            </Link>
          </Button>
        }
      />
      <PageBody>
        <Suspense fallback={<StatsSkeleton />}>
          <Overview searchParams={searchParams} />
        </Suspense>
      </PageBody>
    </>
  );
}

async function Overview({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  const scope = parseScope((await searchParams).data);
  const o = await getOverview(scope);
  const stats = [
    { label: "Total calls", value: o.totalCalls, icon: PhoneCall },
    { label: "Total leads", value: o.totalLeads, icon: Users },
    { label: "Hot leads", value: o.hotLeads, icon: Flame },
    { label: "Visits booked", value: o.appointmentsBooked, icon: CalendarCheck },
    { label: "Visit conversion", value: `${o.conversionRate}%`, icon: Percent, hint: "Leads with a booked site visit ÷ total leads" },
  ];

  return (
    <>
      <div className="flex justify-end">
        <ScopeFilter scope={scope} basePath="/" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {stats.map((s) => (
          <Card key={s.label} className="gap-2 py-4" title={s.hint}>
            <CardHeader className="flex flex-row items-center justify-between px-4">
              <CardDescription className="text-xs font-medium">{s.label}</CardDescription>
              <s.icon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="px-4 text-2xl font-semibold tabular-nums">{s.value}</CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Lead distribution</CardTitle>
            <CardDescription>Deterministic score: Hot ≥ 75, Warm 45–74, Cold &lt; 45</CardDescription>
          </CardHeader>
          <CardContent>
            <DistributionChart data={o.leadDistribution} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Customer sentiment</CardTitle>
            <CardDescription>Classified per call at the end of the conversation</CardDescription>
          </CardHeader>
          <CardContent>
            <DistributionChart data={o.sentimentDistribution} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Recent activity</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {o.activity.length === 0 && <p className="px-6 text-sm text-muted-foreground">No activity yet — start a call from Live Agent.</p>}
          <ul className="divide-y">
            {o.activity.map((a) => (
              <li key={`${a.kind}-${a.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-6 py-3 text-sm">
                {a.kind === "call" ? <PhoneCall className="size-4 text-muted-foreground" /> : <CalendarCheck className="size-4 text-muted-foreground" />}
                <Link href={a.kind === "call" ? `/calls/${a.id}` : "/appointments"} className="font-medium hover:underline">
                  {a.kind === "call" ? `Call with ${a.customer ?? "unknown caller"}` : `Visit booked: ${a.customer ?? "customer"} → ${a.property}`}
                </Link>
                {a.kind === "call" ? <ClassificationBadge value={a.classification} /> : <span className="text-muted-foreground">for {formatIST(a.startsAt)}</span>}
                <StatusBadge value={a.status} />
                <DemoBadge isDemo={a.isDemo} />
                <span className="ml-auto text-xs text-muted-foreground">{formatIST(a.at)}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
