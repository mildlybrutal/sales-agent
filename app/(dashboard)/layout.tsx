import { Suspense } from "react";
import { Building2 } from "lucide-react";
import { Nav, NavFallback } from "@/components/dashboard/nav";

export default function DashboardLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b bg-background md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:border-r md:border-b-0">
        <div className="flex items-center gap-2.5 px-5 py-4">
          <div className="flex size-8 items-center justify-center rounded-md bg-foreground text-background">
            <Building2 className="size-4" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">EstateAI</div>
            <div className="text-xs text-muted-foreground">Sales Console</div>
          </div>
        </div>
        <div className="px-3 pb-3 md:pb-0">
          <Suspense fallback={<NavFallback />}>
            <Nav />
          </Suspense>
        </div>
        <div className="mt-auto hidden px-5 py-4 text-xs text-muted-foreground md:absolute md:bottom-0 md:block">
          All times in IST (Asia/Kolkata)
        </div>
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
