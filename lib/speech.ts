import "server-only";
import { env, ConfigError } from "@/lib/env";

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
  const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(30_000) });
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

/** Streams OpenAI TTS audio (mp3). Returns the upstream body so playback can begin before synthesis finishes. */
export async function synthesizeStream(text: string): Promise<ReadableStream<Uint8Array>> {
  if (!env.openaiApiKey) throw new ConfigError("OPENAI_API_KEY", "Text-to-speech is not configured.");
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.openaiApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.openaiTtsModel,
      voice: env.openaiTtsVoice,
      input: text.slice(0, 4000),
      response_format: "mp3",
      ...(env.openaiTtsModel.startsWith("gpt-") ? { instructions: "Warm, professional Indian English real-estate consultant. Natural pace." } : {}),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok || !res.body) throw new Error(`tts_failed_${res.status}`);
  return res.body;
}
