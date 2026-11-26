"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CalendarCheck, Loader2, Mic, MicOff, PhoneOff, RotateCcw, Send, Volume2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ClassificationBadge, ScoreBar, SentimentBadge } from "@/components/dashboard/badges";
import { formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useVoiceCapture } from "./use-voice-capture";

type Phase = "idle" | "starting" | "listening" | "recording" | "processing" | "speaking" | "ending" | "ended";

interface UiMessage {
  id: string;
  kind: "user" | "agent" | "tool";
  text: string;
  ok?: boolean;
  meta?: string;
}

interface Lead {
  budgetMaxInr: number | null;
  preferredLocation: string | null;
  propertyType: string | null;
  bedrooms: number | null;
  timeline: string | null;
  buyingIntent: string | null;
  score: number;
  classification: string;
  sentiment: string | null;
}

interface Health {
  database: { ok: boolean; properties: number; vectorChunks: number };
  llm: { configured: boolean; model: string };
  stt: { configured: boolean; provider: string; model: string; envVar: string };
  tts: { configured: boolean; provider: string; model: string };
}

interface Summary {
  summary: string;
  leadScore: number;
  leadClassification: string;
  sentiment: string;
  followUpRecommendations: string[];
}

interface Appointment {
  id: string;
  startsAt: string;
  property: { name: string; address?: string };
}

const STORAGE_KEY = "estateai.conversationId";

const PHASE_LABEL: Record<Phase, string> = {
  idle: "Ready",
  starting: "Connecting…",
  listening: "Listening — go ahead and speak",
  recording: "Hearing you…",
  processing: "Thinking…",
  speaking: "Agent speaking",
  ending: "Wrapping up the call…",
  ended: "Call ended",
};

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function VoiceAgent() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [lead, setLead] = useState<Lead | null>(null);
  const [customerName, setCustomerName] = useState<string | null>(null);
  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [resumable, setResumable] = useState(false);
  const [level, setLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  const [draft, setDraft] = useState("");
  const [latency, setLatency] = useState<{ stt?: number; agent?: number; tokens?: number } | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const phaseRef = useRef<Phase>("idle");
  const convRef = useRef<string | null>(null);
  const mutedRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const endAfterSpeechRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const go = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  const inCall = !["idle", "ended", "starting"].includes(phase);

  // ---------- health + resume ----------
  useEffect(() => {
    fetch("/api/health").then((r) => r.json()).then(setHealth).catch(() => {});
    const saved = storage()?.getItem(STORAGE_KEY);
    if (!saved) return;
    fetch(`/api/conversations/${saved}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => {
        if (!c) return storage()?.removeItem(STORAGE_KEY);
        convRef.current = c.id;
        setConversationId(c.id);
        setLead(c.lead);
        setCustomerName(c.customer?.name ?? null);
        setAppointment(c.appointments?.find((a: { status: string }) => a.status === "CONFIRMED") ?? null);
        setMessages(
          c.messages
            .filter((m: { role: string; content?: string; hasToolCalls: boolean }) => m.role !== "TOOL" && !(m.role === "ASSISTANT" && m.hasToolCalls && !m.content))
            .map((m: { id: string; role: string; content: string }) => ({ id: m.id, kind: m.role === "USER" ? "user" : "agent", text: m.content })),
        );
        if (c.status === "ACTIVE") setResumable(true);
        else {
          setSummary(c.summary);
          go("ended");
        }
      })
      .catch(() => {});
  }, [go]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, phase]);

  useEffect(() => {
    if (!startedAt || phase === "ended") return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [startedAt, phase]);

  // ---------- audio out ----------
  const speak = useCallback(
    (messageId: string, text: string) =>
      new Promise<void>((resolve) => {
        go("speaking");
        const browserSpeak = () => {
          if (!("speechSynthesis" in window)) return resolve();
          const u = new SpeechSynthesisUtterance(text);
          const voice = speechSynthesis.getVoices().find((v) => v.lang === "en-IN") ?? speechSynthesis.getVoices().find((v) => v.lang.startsWith("en"));
          if (voice) u.voice = voice;
          u.rate = 1.02;
          u.onend = () => resolve();
          u.onerror = () => resolve();
          speechSynthesis.cancel();
          speechSynthesis.speak(u);
        };
        if (!health?.tts.configured) return browserSpeak();
        const audio = new Audio(`/api/messages/${messageId}/audio`);
        audioRef.current = audio;
        audio.onended = () => resolve();
        audio.onerror = () => browserSpeak();
        audio.play().catch(() => browserSpeak());
      }),
    [go, health?.tts.configured],
  );

  const stopSpeaking = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    if ("speechSynthesis" in window) speechSynthesis.cancel();
  }, []);

  // ---------- capture ----------
  const capture = useVoiceCapture({
    onSpeechStart: () => phaseRef.current === "listening" && go("recording"),
    onUtterance: (blob) => void sendTurn({ audio: blob }),
    onLevel: setLevel,
  });

  const resumeListening = useCallback(() => {
    if (!convRef.current || ["ended", "ending", "idle"].includes(phaseRef.current)) return;
    if (mutedRef.current) {
      go("listening");
      return;
    }
    go("listening");
    capture.listen();
  }, [capture, go]);

  // ---------- end ----------
  const endCall = useCallback(async () => {
    const id = convRef.current;
    if (!id) return;
    capture.close();
    stopSpeaking();
    go("ending");
    try {
      const res = await fetch(`/api/conversations/${id}/end`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setSummary(data.summary);
      if (data.summary) setLead((l) => (l ? { ...l, sentiment: data.summary.sentiment, score: data.summary.leadScore, classification: data.summary.leadClassification } : l));
    } catch (e) {
      toast.error(`Call ended, but the summary failed: ${e instanceof Error ? e.message : "unknown error"}. You can retry from Call History.`);
    }
    setResumable(false);
    go("ended");
  }, [capture, go, stopSpeaking]);

  // ---------- turn ----------
  const sendTurn = useCallback(
    async (input: { audio?: Blob; text?: string }) => {
      const id = convRef.current;
      if (!id) return;
      capture.pause(false);
      go("processing");
      setError(null);
      try {
        let res: Response;
        if (input.audio) {
          const form = new FormData();
          form.append("audio", input.audio, "turn.webm");
          res = await fetch(`/api/conversations/${id}/turn`, { method: "POST", body: form });
        } else {
          setMessages((m) => [...m, { id: `local-${Date.now()}`, kind: "user", text: input.text! }]);
          res = await fetch(`/api/conversations/${id}/turn`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: input.text }) });
        }
        const data = await res.json();
        if (!res.ok) {
          if (data.error === "ended") {
            go("ended");
            return;
          }
          throw new Error(data.envVar ? `${data.message} (${data.envVar})` : data.message || "Request failed");
        }
        if (data.noSpeech) {
          resumeListening();
          return;
        }
        setLatency({ stt: data.sttLatencyMs, agent: data.latencyMs, tokens: data.tokens });
        setMessages((m) => [
          ...(input.audio ? [...m, { id: data.userMessageId, kind: "user" as const, text: data.transcript }] : m),
          ...data.toolEvents.map((t: { name: string; ok: boolean; display: string }, i: number) => ({ id: `${data.userMessageId}-t${i}`, kind: "tool" as const, text: t.display, ok: t.ok, meta: t.name })),
          { id: data.assistantMessage.id, kind: "agent" as const, text: data.assistantMessage.content },
        ]);
        setLead(data.lead);
        setCustomerName(data.customer?.name ?? null);
        if (data.appointment) {
          setAppointment(data.appointment);
          toast.success(`Site visit booked: ${data.appointment.property.name}`);
        }
        if (data.summaryGenerated) endAfterSpeechRef.current = true;

        await speak(data.assistantMessage.id, data.assistantMessage.content);
        if (endAfterSpeechRef.current) {
          endAfterSpeechRef.current = false;
          await endCall();
          return;
        }
        resumeListening();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Something went wrong";
        setError(msg);
        resumeListening();
      }
    },
    [capture, endCall, go, resumeListening, speak],
  );

  // ---------- start ----------
  const openMic = useCallback(async () => {
    try {
      await capture.open();
      return true;
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      setError(
        name === "NotAllowedError"
          ? "Microphone access was blocked. Allow microphone access in your browser's site settings, or type your messages below."
          : name === "NotFoundError"
            ? "No microphone found. Connect one, or type your messages below."
            : "Could not access the microphone. You can type your messages below.",
      );
      mutedRef.current = true;
      setMuted(true);
      return false;
    }
  }, [capture]);

  const startCall = useCallback(async () => {
    setConsentOpen(false);
    go("starting");
    setError(null);
    setSummary(null);
    setAppointment(null);
    setMessages([]);
    setLead(null);
    setCustomerName(null);
    try {
      const res = await fetch("/api/conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ consent: true }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      convRef.current = data.id;
      setConversationId(data.id);
      storage()?.setItem(STORAGE_KEY, data.id);
      setStartedAt(Date.now());
      await openMic();
      setMessages([{ id: data.greeting.id, kind: "agent", text: data.greeting.content }]);
      await speak(data.greeting.id, data.greeting.content);
      resumeListening();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the call");
      go("idle");
    }
  }, [go, openMic, resumeListening, speak]);

  const resumeCall = useCallback(async () => {
    setResumable(false);
    setStartedAt(Date.now());
    go("listening");
    await openMic();
    resumeListening();
  }, [go, openMic, resumeListening]);

  const newCall = () => {
    storage()?.removeItem(STORAGE_KEY);
    convRef.current = null;
    setConversationId(null);
    setResumable(false);
    setConsentChecked(false);
    setConsentOpen(true);
  };

  const toggleMute = async () => {
    const next = !muted;
    if (!next && !(await openMic())) return;
    mutedRef.current = next;
    setMuted(next);
    if (next) capture.pause(false);
    else if (phaseRef.current === "listening") capture.listen();
  };

  const submitText = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !["listening", "recording"].includes(phaseRef.current)) return;
    setDraft("");
    void sendTurn({ text });
  };

  const configProblems = health
    ? [
        !health.database.ok && "Database unreachable (DATABASE_URL)",
        health.database.ok && health.database.properties === 0 && "No properties — run `npm run db:seed`",
        !health.llm.configured && "LLM not configured — set GROQ_API_KEY",
        !health.stt.configured && `Speech-to-text not configured — set ${health.stt.envVar}`,
      ].filter(Boolean)
    : [];

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card className="flex min-h-[640px] flex-col gap-0 py-0 xl:col-span-2">
        {/* Call bar */}
        <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
          <StatusDot phase={phase} level={level} />
          <div className="min-w-0">
            <div className="text-sm font-medium">{PHASE_LABEL[phase]}</div>
            <div className="text-xs text-muted-foreground">
              {conversationId ? `Call ${conversationId.slice(0, 8)}` : "No active call"}
              {inCall && startedAt ? ` · ${mm}:${ss}` : ""}
              {latency && ` · STT ${latency.stt ?? "–"} ms · agent ${latency.agent} ms · ${latency.tokens ?? "–"} tokens`}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {inCall && (
              <>
                {phase === "recording" && (
                  <Button size="sm" variant="outline" onClick={() => capture.pause(true)}>
                    <Send /> Done speaking
                  </Button>
                )}
                {phase === "speaking" && (
                  <Button size="sm" variant="outline" onClick={() => { stopSpeaking(); resumeListening(); }}>
                    <Volume2 /> Skip
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={toggleMute} aria-pressed={muted}>
                  {muted ? <MicOff /> : <Mic />} {muted ? "Unmute" : "Mute"}
                </Button>
                <Button size="sm" variant="destructive" onClick={endCall} disabled={phase === "processing"}>
                  <PhoneOff /> End call
                </Button>
              </>
            )}
            {phase === "idle" && !resumable && (
              <Button onClick={() => { setConsentChecked(false); setConsentOpen(true); }} disabled={configProblems.length > 0 && !health?.llm.configured}>
                <Mic /> Start call
              </Button>
            )}
            {phase === "idle" && resumable && (
              <>
                <Button variant="outline" onClick={newCall}>New call</Button>
                <Button onClick={resumeCall}><RotateCcw /> Resume call</Button>
              </>
            )}
            {phase === "ended" && <Button onClick={newCall}><Mic /> New call</Button>}
          </div>
        </div>

        {/* Transcript */}
        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4" style={{ maxHeight: 560 }}>
          {messages.length === 0 && phase === "idle" && (
            <div className="mx-auto max-w-md py-16 text-center">
              <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
                <Mic className="size-5 text-muted-foreground" />
              </div>
              <h2 className="font-medium">Talk to Akash, EstateAI&apos;s voice sales agent</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Try: &ldquo;I&apos;m looking for a 3BHK apartment in Baner under one crore.&rdquo; Speak naturally — the agent detects when you stop talking.
              </p>
            </div>
          )}
          {messages.map((m) =>
            m.kind === "tool" ? (
              <div key={m.id} className="flex items-start gap-2 pl-1 text-xs text-muted-foreground">
                <Wrench className={cn("mt-0.5 size-3 shrink-0", m.ok ? "" : "text-amber-600")} />
                <span>
                  <span className="font-mono">{m.meta}</span> — {m.text}
                </span>
              </div>
            ) : (
              <div key={m.id} className={cn("flex", m.kind === "user" ? "justify-end" : "justify-start")}>
                <div className={cn("max-w-[80%] rounded-lg px-3 py-2 text-sm", m.kind === "user" ? "bg-foreground text-background" : "border bg-muted/40")}>
                  <div className="mb-0.5 text-[11px] opacity-60">{m.kind === "user" ? "You" : "Akash · EstateAI"}</div>
                  {m.text}
                </div>
              </div>
            ),
          )}
          {phase === "processing" && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" /> Transcribing and thinking…
            </div>
          )}
        </div>

        {error && (
          <div className="mx-4 mb-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {error}
          </div>
        )}

        {/* Typed fallback */}
        <form onSubmit={submitText} className="flex gap-2 border-t px-4 py-3">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={inCall ? "Or type a message…" : "Start a call to chat"}
            disabled={!["listening", "recording"].includes(phase)}
            maxLength={1000}
          />
          <Button type="submit" variant="outline" disabled={!draft.trim() || !["listening", "recording"].includes(phase)}>
            <Send /> Send
          </Button>
        </form>
      </Card>

      {/* Side panel */}
      <div className="space-y-4">
        {appointment && (
          <Card className="border-emerald-200 bg-emerald-50/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm text-emerald-800">
                <CalendarCheck className="size-4" /> Visit booked
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              <div className="font-medium">{appointment.property.name}</div>
              <div>{new Date(appointment.startsAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "full", timeStyle: "short" })} IST</div>
              {appointment.property.address && <div className="mt-1 text-xs text-muted-foreground">{appointment.property.address}</div>}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Live lead profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {!lead ? (
              <p className="text-muted-foreground">Details appear here as the agent learns them.</p>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <ScoreBar score={lead.score} />
                  <ClassificationBadge value={lead.classification} />
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                  <Field k="Name" v={customerName} />
                  <Field k="Budget" v={lead.budgetMaxInr ? formatINR(lead.budgetMaxInr) : null} />
                  <Field k="Location" v={lead.preferredLocation} />
                  <Field k="Bedrooms" v={lead.bedrooms ? `${lead.bedrooms}BHK` : null} />
                  <Field k="Type" v={lead.propertyType?.toLowerCase().replace("_", " ")} />
                  <Field k="Timeline" v={lead.timeline} />
                  <Field k="Intent" v={lead.buyingIntent?.toLowerCase()} />
                  <div>
                    <dt className="text-xs text-muted-foreground">Sentiment</dt>
                    <dd><SentimentBadge value={lead.sentiment} /></dd>
                  </div>
                </dl>
              </>
            )}
          </CardContent>
        </Card>

        {summary && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Call summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>{summary.summary}</p>
              <div className="flex gap-2">
                <ClassificationBadge value={summary.leadClassification} />
                <SentimentBadge value={summary.sentiment} />
              </div>
              <ul className="list-disc pl-4 text-muted-foreground">
                {summary.followUpRecommendations.map((f) => <li key={f}>{f}</li>)}
              </ul>
              {conversationId && (
                <Link href={`/calls/${conversationId}`} className="block pt-1 text-xs underline">
                  Open in Call History →
                </Link>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Pipeline status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-xs">
            {!health ? (
              <p className="text-muted-foreground">Checking…</p>
            ) : (
              <>
                <StatusRow ok={health.database.ok} label="PostgreSQL" detail={health.database.ok ? `${health.database.properties} properties` : "unreachable"} />
                <StatusRow ok={health.database.vectorChunks > 0} label="RAG (pgvector)" detail={`${health.database.vectorChunks} embedded chunks`} />
                <StatusRow ok={health.stt.configured} label="Speech-to-text" detail={health.stt.configured ? `${health.stt.provider} ${health.stt.model}` : `set ${health.stt.envVar}`} />
                <StatusRow ok={health.llm.configured} label="LLM" detail={health.llm.configured ? `groq ${health.llm.model}` : "set GROQ_API_KEY"} />
                <StatusRow ok={health.tts.configured} warn={!health.tts.configured} label="Text-to-speech" detail={health.tts.configured ? `openai ${health.tts.model}` : "browser voice fallback (set OPENAI_API_KEY)"} />
                <p className="pt-1 text-muted-foreground">Turn-based: audio is sent after you stop speaking; TTS audio streams back as it is generated.</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={consentOpen} onOpenChange={setConsentOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Before we start</DialogTitle>
            <DialogDescription>
              This call uses your microphone. Your voice is sent to our speech-to-text provider, and the transcript, your requirements and any booking are stored in EstateAI&apos;s CRM so our team can follow up.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-start gap-3 rounded-md border p-3">
            <Checkbox id="consent" checked={consentChecked} onCheckedChange={(v) => setConsentChecked(v === true)} />
            <Label htmlFor="consent" className="text-sm leading-snug font-normal">
              I consent to this call being recorded, transcribed and stored.
            </Label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConsentOpen(false)}>Cancel</Button>
            <Button onClick={startCall} disabled={!consentChecked}>
              <Mic /> Start call
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ k, v }: { k: string; v: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{k}</dt>
      <dd className={cn("capitalize", !v && "text-muted-foreground")}>{v || "—"}</dd>
    </div>
  );
}

function StatusRow({ ok, warn, label, detail }: { ok: boolean; warn?: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn("size-1.5 shrink-0 rounded-full", ok ? "bg-emerald-500" : warn ? "bg-amber-500" : "bg-red-500")} />
      <span className="font-medium">{label}</span>
      <span className="truncate text-muted-foreground">{detail}</span>
    </div>
  );
}

function StatusDot({ phase, level }: { phase: Phase; level: number }) {
  const color =
    phase === "recording" ? "bg-red-500" : phase === "listening" ? "bg-emerald-500" : phase === "speaking" ? "bg-blue-500" : phase === "processing" || phase === "starting" || phase === "ending" ? "bg-amber-500" : "bg-slate-300";
  return (
    <div className="relative flex size-9 items-center justify-center">
      {(phase === "listening" || phase === "recording") && (
        <span className={cn("absolute inset-0 rounded-full opacity-20 transition-transform", color)} style={{ transform: `scale(${0.6 + level * 0.9})` }} />
      )}
      {phase === "processing" ? <Loader2 className="size-4 animate-spin text-amber-600" /> : <span className={cn("relative size-3 rounded-full", color)} />}
    </div>
  );
}
