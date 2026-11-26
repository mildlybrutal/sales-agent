import Link from "next/link";
import { Suspense } from "react";
import { PageBody, PageHeader } from "@/components/dashboard/page-header";
import { ClassificationBadge, DemoBadge, StatusBadge } from "@/components/dashboard/badges";
import { ScopeFilter } from "@/components/dashboard/scope-filter";
import { TableSkeleton } from "@/components/dashboard/loading";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getAppointments, parseScope } from "@/lib/queries";
import { formatINR } from "@/lib/format";
import { formatIST } from "@/lib/time";

export const metadata = { title: "Appointments" };

export default function AppointmentsPage({ searchParams }: PageProps<"/appointments">) {
  return (
    <>
      <PageHeader title="Appointments" description="Site visits booked by the voice agent · Asia/Kolkata (IST)" />
      <PageBody>
        <Suspense fallback={<TableSkeleton />}>
          <Appointments searchParams={searchParams} />
        </Suspense>
      </PageBody>
    </>
  );
}

type Appt = Awaited<ReturnType<typeof getAppointments>>["upcoming"][number];

function ApptTable({ rows, empty }: { rows: Appt[]; empty: string }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Date &amp; time (IST)</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Property</TableHead>
            <TableHead>Price</TableHead>
            <TableHead>Lead</TableHead>
            <TableHead className="pr-4">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">{empty}</TableCell></TableRow>
          )}
          {rows.map((a) => (
            <TableRow key={a.id}>
              <TableCell className="pl-4 font-medium whitespace-nowrap">{formatIST(a.startsAt)}</TableCell>
              <TableCell>
                {a.customer.lead ? (
                  <Link href={`/leads/${a.customer.lead.id}`} className="hover:underline">{a.customer.name ?? "Unknown"}</Link>
                ) : (a.customer.name ?? "Unknown")}
                <span className="ml-2"><DemoBadge isDemo={a.isDemo} /></span>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">{a.customer.phone ?? "—"}</TableCell>
              <TableCell>
                <div className="font-medium">{a.property.name}</div>
                <div className="text-xs text-muted-foreground">{a.property.location} · {a.property.bedrooms}BHK</div>
              </TableCell>
              <TableCell className="tabular-nums">{formatINR(a.property.priceInr)}</TableCell>
              <TableCell><ClassificationBadge value={a.customer.lead?.classification} /></TableCell>
              <TableCell className="pr-4"><StatusBadge value={a.status} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

async function Appointments({ searchParams }: { searchParams: PageProps<"/appointments">["searchParams"] }) {
  const scope = parseScope((await searchParams).data);
  const { upcoming, past } = await getAppointments(scope);
  return (
    <>
      <div className="flex justify-end"><ScopeFilter scope={scope} basePath="/appointments" /></div>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Upcoming ({upcoming.length})</h2>
        <ApptTable rows={upcoming} empty="No upcoming visits." />
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Past &amp; cancelled</h2>
        <ApptTable rows={past} empty="Nothing here yet." />
      </section>
    </>
  );
}
