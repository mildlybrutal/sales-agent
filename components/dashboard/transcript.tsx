import { cn } from "@/lib/utils";
import { formatIST } from "@/lib/time";

interface Msg {
  id: string;
  role: string;
  content: string;
  toolName?: string | null;
  toolCalls?: unknown;
  createdAt: Date;
}

/** Read-only transcript. Tool calls are shown as compact system lines; tool payloads are not rendered. */
export function Transcript({ messages, showTools = true }: { messages: Msg[]; showTools?: boolean }) {
  return (
    <ol className="space-y-3">
      {messages.map((m) => {
        if (m.role === "TOOL") {
          return showTools ? (
            <li key={m.id} className="pl-2 font-mono text-[11px] text-muted-foreground">
              ↳ tool result · {m.toolName}
            </li>
          ) : null;
        }
        if (m.role === "ASSISTANT" && m.toolCalls) {
          const calls = (m.toolCalls as { function: { name: string } }[]).map((c) => c.function.name);
          return showTools ? (
            <li key={m.id} className="pl-2 font-mono text-[11px] text-muted-foreground">
              ⚙ agent called {calls.join(", ")}
            </li>
          ) : null;
        }
        if (!m.content.trim()) return null;
        const user = m.role === "USER";
        return (
          <li key={m.id} className={cn("flex flex-col", user ? "items-end" : "items-start")}>
            <div className={cn("max-w-[85%] rounded-lg px-3 py-2 text-sm", user ? "bg-foreground text-background" : "border bg-background")}>{m.content}</div>
            <span className="mt-1 text-[11px] text-muted-foreground">
              {user ? "Customer" : "Agent"} · {formatIST(m.createdAt, { weekday: undefined, year: undefined })}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
