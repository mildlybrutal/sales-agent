import "server-only";
import { env, ConfigError } from "@/lib/env";
import { fetchWithRetry } from "@/lib/fetch-retry";
import { kokoroPcm, KOKORO_SAMPLE_RATE } from "@/lib/tts-kokoro";

/** Vocabulary hint so Whisper spells Pune localities and Indian units correctly. */
const STT_PROMPT = "EstateAI, Pune, Baner, Hinjewadi, Wakad, Kharadi, Balewadi, BHK, 2BHK, 3BHK, lakh, crore, site visit.";

export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

export async function transcribe(audio: Blob, filename: string): Promise<string> {
  const useOpenAI = env.sttProvider === "openai";
  const key = useOpenAI ? env.openaiApiKey : env.groqApiKey;
  if (!key) throw new ConfigError(useOpenAI ? "OPENAI_API_KEY" : "GROQ_API_KEY", "Speech-to-text is not configured.");

  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", useOpenAI ? "whisper-1" : env.groqSttModel);
  form.append("language", "en");
  form.append("prompt", STT_PROMPT);
  form.append("response_format", "json");
  form.append("temperature", "0");

  const url = useOpenAI ? "https://api.openai.com/v1/audio/transcriptions" : `${env.groqBaseUrl}/audio/transcriptions`;
  const res = await fetchWithRetry(url, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`stt_failed_${res.status}`);
  const data = (await res.json()) as { text?: string };
  return (data.text ?? "").trim();
}

/** Whisper hallucinates these on silence / noise; treat as no speech. */
const HALLUCINATIONS = [/^thank(s| you)( for watching)?[.!]?$/i, /^you$/i, /^\.+$/, /^bye[.!]?$/i];
export function isLikelySilence(text: string) {
  const t = text.trim();
  return t.length < 2 || HALLUCINATIONS.some((r) => r.test(t)) && t.length < 25;
}

export type SpeechStream = { stream: ReadableStream<Uint8Array>; contentType: string; provider: string };

/** A TTS provider failed (quota, HTTP error, network); the client falls back to the browser voice. */
export class TtsUnavailableError extends Error {
  constructor(public provider: string, public reason: string) {
    super(`tts_unavailable ${provider} ${reason}`);
    this.name = "TtsUnavailableError";
  }
}

const TTS_STYLE = "Warm, professional Indian English real-estate consultant. Natural pace.";

/**
 * Streams TTS audio for `text` from the configured provider. Resolves once the
 * provider has accepted the request (so HTTP errors surface as exceptions), then
 * hands back the body so playback can begin before synthesis finishes.
 */
export async function synthesizeStream(text: string): Promise<SpeechStream> {
  const input = text.slice(0, 4000);
  if (env.ttsProvider === "browser") throw new ConfigError("TTS_PROVIDER", "Server text-to-speech is disabled.");
  if (env.ttsProvider === "kokoro") return kokoroSpeech(input);
  if (env.ttsProvider === "gemini" && Date.now() < geminiBlockedUntil) return kokoroSpeech(input);
  try {
    return env.ttsProvider === "openai" ? await openaiSpeech(input) : await geminiSpeech(input);
  } catch (e) {
    if (e instanceof ConfigError) throw e;
    // A hosted provider failed (quota, outage, network): the local voice still works.
    console.warn(`[tts] ${env.ttsProvider} failed (${e instanceof Error ? e.message : "unknown"}); using kokoro for this reply`);
    return kokoroSpeech(input);
  }
}

/**
 * Local Kokoro, streamed sentence by sentence behind an open-ended WAV header.
 * The first sentence is synthesised before returning so a model-load failure
 * becomes an error response rather than an empty audio stream.
 */
async function kokoroSpeech(input: string): Promise<SpeechStream> {
  const chunks = kokoroPcm(speakable(input), env.kokoroVoice);
  let first: IteratorResult<Uint8Array>;
  try {
    first = await chunks.next();
  } catch (e) {
    throw new TtsUnavailableError("kokoro", e instanceof Error ? e.message.slice(0, 120) : "load_failed");
  }
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(wavHeader(KOKORO_SAMPLE_RATE));
      if (!first.done) controller.enqueue(first.value);
      else controller.close();
    },
    async pull(controller) {
      const next = await chunks.next();
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
    async cancel() {
      await chunks.return(undefined); // releases the synthesis queue
    },
  });
  return { stream, contentType: "audio/wav", provider: "kokoro" };
}

/** Kokoro reads text literally; rewrite the bits of agent replies it would mangle. */
function speakable(text: string) {
  return text
    .replace(/[*_`#>]+/g, "") // markdown
    .replace(/₹\s?([\d.,]+)\s*(lakh|lakhs|crore|crores|L|Cr)\b/gi, "$1 $2")
    .replace(/₹\s?([\d,]+(?:\.\d+)?)/g, "$1 rupees")
    .replace(/(\d)\s?L\b/g, "$1 lakh")
    .replace(/(\d)\s?Cr\b/g, "$1 crore")
    .replace(/(\d)\s?BHK\b/gi, "$1 B H K")
    .replace(/\bBHK\b/gi, "B H K")
    .replace(/\bsq\.?\s?ft\b/gi, "square feet")
    .replace(/\bIST\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function openaiSpeech(input: string): Promise<SpeechStream> {
  if (!env.openaiApiKey) throw new ConfigError("OPENAI_API_KEY", "Text-to-speech is not configured.");
  const res = await fetchWithRetry("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.openaiApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.openaiTtsModel,
      voice: env.openaiTtsVoice,
      input,
      response_format: "mp3",
      ...(env.openaiTtsModel.startsWith("gpt-") ? { instructions: TTS_STYLE } : {}),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok || !res.body) throw new TtsUnavailableError("openai", `http_${res.status}`);
  return { stream: res.body, contentType: "audio/mpeg", provider: "openai" };
}

const GEMINI_SAMPLE_RATE = 24_000;

/** Set when Gemini returns 429; until then replies go straight to Kokoro (free tier: 10 TTS requests/day). */
let geminiBlockedUntil = 0;

/**
 * Gemini TTS via the Interactions API in streaming mode. Gemini streams headerless
 * 16-bit mono PCM (audio/l16) over SSE; we prefix an open-ended WAV header so a
 * plain <audio> element can play it as it arrives (first audio ≈ 3 s vs ≈ 10 s unary).
 */
async function geminiSpeech(input: string): Promise<SpeechStream> {
  if (!env.geminiApiKey) throw new ConfigError("GEMINI_API_KEY", "Text-to-speech is not configured.");
  const res = await fetchWithRetry("https://generativelanguage.googleapis.com/v1beta/interactions?alt=sse", {
    method: "POST",
    headers: { "x-goog-api-key": env.geminiApiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.geminiTtsModel,
      input: [{ type: "user_input", content: [{ type: "text", text: input, annotations: [{ type: "speech_metadata", style: TTS_STYLE }] }] }],
      response_format: { type: "audio", sample_rate: GEMINI_SAMPLE_RATE },
      generation_config: { speech_config: [{ voice: env.geminiTtsVoice }] },
      stream: true,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (res.status === 429) {
    // e.g. "Please retry in 2h9m52s." Without a hint, back off for 10 minutes.
    let body = "";
    try {
      body = await res.text();
    } catch {}
    const m = /retry in (?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?/i.exec(body);
    const waitMs = m && (m[1] || m[2] || m[3]) ? ((Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0)) * 1000 : 10 * 60_000;
    geminiBlockedUntil = Date.now() + waitMs;
    throw new TtsUnavailableError("gemini", `quota; paused for ${Math.round(waitMs / 60_000)} min`);
  }
  if (!res.ok || !res.body) throw new TtsUnavailableError("gemini", `http_${res.status}`);

  const upstream = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = "";
  let carry: Uint8Array | null = null; // odd trailing byte, so every chunk holds whole 16-bit samples

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(wavHeader(GEMINI_SAMPLE_RATE));
    },
    async pull(controller) {
      for (;;) {
        const { done, value } = await upstream.read();
        if (done) {
          controller.close();
          return;
        }
        buffered += value;
        const events = buffered.split(/\r?\n\r?\n/);
        buffered = events.pop() ?? "";
        let emitted = false;
        for (const ev of events) {
          const pcm = audioFromSseEvent(ev);
          if (!pcm) continue;
          let bytes = carry ? concat(carry, pcm) : pcm;
          carry = null;
          if (bytes.length % 2) {
            carry = bytes.slice(-1);
            bytes = bytes.slice(0, -1);
          }
          if (bytes.length) {
            controller.enqueue(bytes);
            emitted = true;
          }
        }
        if (emitted) return;
      }
    },
    cancel(reason) {
      return upstream.cancel(reason);
    },
  });
  return { stream, contentType: "audio/wav", provider: "gemini" };
}

/** Pulls PCM out of one SSE event; throws on a streamed error so the response aborts. */
function audioFromSseEvent(event: string): Uint8Array | null {
  const data = event
    .split(/\r?\n/)
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trimStart())
    .join("\n");
  if (!data) return null;
  let parsed: { event_type?: string; delta?: { mime_type?: string; data?: string }; error?: { code?: number } };
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (parsed.event_type === "error" || parsed.error) throw new Error(`tts_failed_stream_${parsed.error?.code ?? "error"}`);
  const d = parsed.delta;
  if (!d?.data || !d.mime_type?.startsWith("audio/")) return null;
  return Uint8Array.from(Buffer.from(d.data, "base64"));
}

/** 44-byte PCM WAV header with unknown (max) length, for streaming playback. */
function wavHeader(sampleRate: number): Uint8Array {
  const h = new DataView(new ArrayBuffer(44));
  const str = (o: number, s: string) => [...s].forEach((c, i) => h.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  h.setUint32(4, 0xffffffff, true);
  str(8, "WAVE");
  str(12, "fmt ");
  h.setUint32(16, 16, true); // fmt chunk size
  h.setUint16(20, 1, true); // PCM
  h.setUint16(22, 1, true); // mono
  h.setUint32(24, sampleRate, true);
  h.setUint32(28, sampleRate * 2, true); // byte rate
  h.setUint16(32, 2, true); // block align
  h.setUint16(34, 16, true); // bits per sample
  str(36, "data");
  h.setUint32(40, 0xffffffff, true);
  return new Uint8Array(h.buffer);
}

function concat(a: Uint8Array, b: Uint8Array) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}
