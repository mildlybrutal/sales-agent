"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Ends an abandoned call and/or (re)generates its summary via POST /api/conversations/:id/end. */
export function SummarizeButton({ conversationId, regenerate = false }: { conversationId: string; regenerate?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const res = await fetch(`/api/conversations/${conversationId}/end${regenerate ? "?regenerate=1" : ""}`, { method: "POST" });
          const data = await res.json();
          if (!res.ok) throw new Error(data.message ?? "Failed");
          toast.success("Summary saved");
          router.refresh();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Failed to generate summary");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
      {regenerate ? "Regenerate summary" : "End call & summarise"}
    </Button>
  );
}
