import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageBody } from "@/components/dashboard/page-header";
import { ClassificationBadge, DemoBadge, ScoreBar, SentimentBadge, StatusBadge } from "@/components/dashboard/badges";
import { Transcript } from "@/components/dashboard/transcript";
import { TableSkeleton } from "@/components/dashboard/loading";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getLead } from "@/lib/queries";
import { formatDuration, formatINR } from "@/lib/format";
import { formatIST } from "@/lib/time";
import { uuidRe } from "@/lib/ids";
import type { ScoreBreakdown } from "@/lib/scoring";

export const metadata = { title: "Lead" };

export default function LeadPage({ params }: PageProps<"/leads/[id]">) {
  return (
    <Suspense fallback={<PageBody><TableSkeleton rows={10} /></PageBody>}>
      <LeadDetail params={params} />
    </Suspense>
  );
}

async function LeadDetail({ params }: { params: PageProps<"/leads/[id]">["params"] }) {
  const { id } = await params;
  if (!uuidRe.test(id)) notFound();
  const lead = await getLead(id);
  if (!lead) notFound();
  const c = lead.customer;
  const bd = lead.scoreBreakdown as unknown as ScoreBreakdown | null;

  const fields: [string, React.ReactNode][] = [
    ["Phone", c.phone ?? "—"],
    ["Budget (max)", formatINR(lead.budgetMaxInr)],
    ["Preferred location", lead.preferredLocation ?? "—"],
    ["Bedrooms", lead.bedrooms ? `${lead.bedrooms}BHK` : "—"],
    ["Property type", lead.propertyType?.toLowerCase().replace("_", " ") ?? "—"],
    ["Purchase timeline", lead.timeline ?? "—"],
    ["Buying intent", lead.buyingIntent?.toLowerCase() ?? "—"],
    ["Notes", lead.requirementsNotes ?? "—"],
  ];

  return (
    <>
      <div className="border-b bg-background px-4 py-5 md:px-8">
        <Link href="/leads" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Leads
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">{c.name ?? "Unknown caller"}</h1>
          <ClassificationBadge value={lead.classification} />
          <SentimentBadge value={lead.sentiment} />
          <StatusBadge value={lead.stage} />
          <DemoBadge isDemo={lead.isDemo} />
        </div>
      </div>
      <PageBody>
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle className="text-sm">Requirements</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                {fields.map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs text-muted-foreground">{k}</dt>
                    <dd className="text-sm">{v}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">Lead score</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <ScoreBar score={lead.score} />
              {bd && (
                <table className="w-full text-sm">
                  <tbody className="[&_td]:py-1">
                    <tr><td className="text-muted-foreground">Budget matches inventory</td><td className="text-right tabular-nums">{bd.budget}/30</td></tr>
                    <tr><td className="text-muted-foreground">Purchase timeline</td><td className="text-right tabular-nums">{bd.timeline}/30</td></tr>
                    <tr><td className="text-muted-foreground">Buying intent</td><td className="text-right tabular-nums">{bd.intent}/25</td></tr>
                    <tr><td className="text-muted-foreground">Requirement match</td><td className="text-right tabular-nums">{bd.requirementMatch}/15</td></tr>
                  </tbody>
                </table>
              )}
              {bd && <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">{bd.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-sm">Appointments</CardTitle></CardHeader>
          <CardContent>
            {c.appointments.length === 0 ? <p className="text-sm text-muted-foreground">No site visits booked.</p> : (
              <ul className="divide-y text-sm">
                {c.appointments.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-3 py-2">
                    <span className="font-medium">{a.property.name}</span>
                    <span className="text-muted-foreground">{a.property.location}</span>
                    <span>{formatIST(a.startsAt)}</span>
                    <StatusBadge value={a.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <h2 className="text-sm font-semibold">Conversation history ({c.conversations.length})</h2>
          {c.conversations.map((conv) => (
            <Card key={conv.id}>
              <CardHeader className="flex flex-row flex-wrap items-center gap-3">
                <CardTitle className="text-sm">
                  <Link href={`/calls/${conv.id}`} className="hover:underline">{formatIST(conv.startedAt)}</Link>
                </CardTitle>
                <span className="text-xs text-muted-foreground">{formatDuration(conv.durationSec)}</span>
                <StatusBadge value={conv.status} />
                <SentimentBadge value={conv.sentiment} />
              </CardHeader>
              <CardContent className="space-y-4">
                {conv.summary && <p className="rounded-md bg-muted/60 p-3 text-sm">{conv.summary.summary}</p>}
                <Transcript messages={conv.messages} showTools={false} />
              </CardContent>
            </Card>
          ))}
        </div>
      </PageBody>
    </>
  );
}
