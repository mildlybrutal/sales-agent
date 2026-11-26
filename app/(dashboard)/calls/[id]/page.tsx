import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageBody } from "@/components/dashboard/page-header";
import { ClassificationBadge, DemoBadge, SentimentBadge, StatusBadge } from "@/components/dashboard/badges";
import { Transcript } from "@/components/dashboard/transcript";
import { SummarizeButton } from "@/components/dashboard/summarize-button";
import { TableSkeleton } from "@/components/dashboard/loading";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCall } from "@/lib/queries";
import { formatDuration } from "@/lib/format";
import { formatIST } from "@/lib/time";
import { uuidRe } from "@/lib/ids";

export const metadata = { title: "Call" };

export default function CallPage({ params }: PageProps<"/calls/[id]">) {
  return (
    <Suspense fallback={<PageBody><TableSkeleton rows={10} /></PageBody>}>
      <CallDetail params={params} />
    </Suspense>
  );
}

const REQ_LABELS: Record<string, string> = {
  name: "Name", budget: "Budget", preferredLocation: "Location", bedrooms: "Bedrooms", propertyType: "Type",
  timeline: "Timeline", buyingIntent: "Intent", notes: "Notes", phone: "Phone",
};

async function CallDetail({ params }: { params: PageProps<"/calls/[id]">["params"] }) {
  const { id } = await params;
  if (!uuidRe.test(id)) notFound();
  const call = await getCall(id);
  if (!call) notFound();
  const s = call.summary;
  const req = (s?.customerRequirements ?? {}) as Record<string, unknown>;
  const props = (s?.propertiesDiscussed ?? []) as { id: string; name: string; location: string; price: string }[];
  const appt = s?.appointmentDetails as { property: string; label?: string; startsAt: string; status: string } | null;

  return (
    <>
      <div className="border-b bg-background px-4 py-5 md:px-8">
        <Link href="/calls" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Call History
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">Call with {call.customer.name ?? "unknown caller"}</h1>
          <StatusBadge value={call.status} />
          <DemoBadge isDemo={call.isDemo} />
          <div className="ml-auto">{!call.isDemo && <SummarizeButton conversationId={call.id} regenerate={Boolean(s)} />}</div>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {formatIST(call.startedAt)} · {formatDuration(call.durationSec)} · {call.turnCount} customer turns · consent recorded {formatIST(call.consentGivenAt)}
        </p>
      </div>
      <PageBody>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-1">
            <Card>
              <CardHeader><CardTitle className="text-sm">Call summary</CardTitle></CardHeader>
              <CardContent className="space-y-4 text-sm">
                {!s ? (
                  <p className="text-muted-foreground">No summary yet. {call.status === "ACTIVE" ? "End the call to generate one." : ""}</p>
                ) : (
                  <>
                    <p>{s.summary}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <ClassificationBadge value={s.leadClassification} />
                      <span className="tabular-nums text-muted-foreground">Score {s.leadScore}/100</span>
                      <SentimentBadge value={s.sentiment} />
                    </div>
                    {s.sentimentReason && <p className="text-xs text-muted-foreground">Sentiment: {s.sentimentReason}</p>}
                    <div>
                      <h3 className="mb-1 text-xs font-medium text-muted-foreground">Customer requirements</h3>
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                        {Object.entries(REQ_LABELS).map(([k, label]) =>
                          req[k] != null ? (
                            <div key={k} className="contents">
                              <dt className="text-muted-foreground">{label}</dt>
                              <dd>{String(req[k])}</dd>
                            </div>
                          ) : null,
                        )}
                      </dl>
                    </div>
                    <div>
                      <h3 className="mb-1 text-xs font-medium text-muted-foreground">Properties discussed</h3>
                      {props.length ? <ul className="space-y-0.5">{props.map((p) => <li key={p.id}>{p.name} · {p.location} · {p.price}</li>)}</ul> : <p className="text-muted-foreground">None</p>}
                    </div>
                    <div>
                      <h3 className="mb-1 text-xs font-medium text-muted-foreground">Appointment</h3>
                      {appt ? <p>{appt.property} · {appt.label ?? formatIST(new Date(appt.startsAt))} · {appt.status.toLowerCase()}</p> : <p className="text-muted-foreground">No visit booked</p>}
                    </div>
                    <div>
                      <h3 className="mb-1 text-xs font-medium text-muted-foreground">Follow-up recommendations</h3>
                      <ul className="list-disc space-y-0.5 pl-4">{s.followUpRecommendations.map((f) => <li key={f}>{f}</li>)}</ul>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
            {call.customer.lead && (
              <Link href={`/leads/${call.customer.lead.id}`} className="block text-sm text-muted-foreground hover:text-foreground hover:underline">
                View lead profile →
              </Link>
            )}
          </div>
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle className="text-sm">Transcript</CardTitle></CardHeader>
            <CardContent>
              <Transcript messages={call.messages} />
            </CardContent>
          </Card>
        </div>
      </PageBody>
    </>
  );
}
