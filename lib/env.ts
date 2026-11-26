import "server-only";

/**
 * Server-only access to configuration. Keys never leave the server; the client
 * only ever sees the boolean `configured` flags from getPublicConfigStatus().
 */
export const env = {
  groqApiKey: process.env.GROQ_API_KEY?.trim() || undefined,
  groqBaseUrl: (process.env.GROQ_BASE_URL?.trim() || "https://api.groq.com/openai/v1").replace(/\/$/, ""),
  groqModel: process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b",
  geminiApiKey: process.env.GEMINI_API_KEY?.trim() || undefined,
  geminiBaseUrl: (process.env.GEMINI_BASE_URL?.trim() || "https://generativelanguage.googleapis.com/v1beta/openai").replace(/\/$/, ""),
  /** reasoning_effort sent to Gemini: "none" (fastest; supported by gemini-2.5-flash), "low", … or "" to omit. */
  geminiReasoningEffort: process.env.GEMINI_REASONING_EFFORT?.trim() ?? "none",
  /**
   * Models tried, in order, when GROQ_MODEL is rate limited. Comma-separated; "" disables.
   * Names starting with "gemini-" go to Google's OpenAI-compatible API (needs GEMINI_API_KEY);
   * anything else is a Groq model (Groq limits are per model, so it's a separate free quota).
   */
  fallbackModels: parseModelList(
    process.env.LLM_FALLBACK_MODEL ?? process.env.GROQ_FALLBACK_MODEL,
    process.env.GEMINI_API_KEY?.trim() ? "gemini-2.5-flash" : "openai/gpt-oss-20b",
  ),
  /** End-of-call summaries run here so they don't consume the conversation model's quota. */
  summaryModel: "", // set below
  groqSttModel: process.env.GROQ_STT_MODEL?.trim() || "whisper-large-v3-turbo",
  openaiApiKey: process.env.OPENAI_API_KEY?.trim() || undefined,
  openaiTtsModel: process.env.OPENAI_TTS_MODEL?.trim() || "gpt-4o-mini-tts",
  openaiTtsVoice: process.env.OPENAI_TTS_VOICE?.trim() || "alloy",
  /**
   * Text-to-speech: "openai" | "kokoro" | "gemini" | "browser". Unset → openai if
   * OPENAI_API_KEY is set, else local Kokoro. Gemini is opt-in (free tier: 10 req/day).
   */
  ttsProvider: resolveTtsProvider(process.env.TTS_PROVIDER?.trim().toLowerCase()),
  geminiTtsModel: process.env.GEMINI_TTS_MODEL?.trim() || "gemini-3.8-flash-tts",
  geminiTtsVoice: process.env.GEMINI_TTS_VOICE?.trim() || "Sulafat",
  kokoroVoice: process.env.KOKORO_VOICE?.trim() || "af_heart",
  sttProvider: (process.env.STT_PROVIDER?.trim() === "openai" ? "openai" : "groq") as "groq" | "openai",
  embeddingModel: process.env.EMBEDDING_MODEL?.trim() || "Xenova/all-MiniLM-L6-v2",
};

env.summaryModel =
  (process.env.LLM_SUMMARY_MODEL ?? process.env.GROQ_SUMMARY_MODEL)?.trim() || env.fallbackModels[0] || env.groqModel;

type TtsProvider = "openai" | "kokoro" | "gemini" | "browser";

function resolveTtsProvider(raw: string | undefined): TtsProvider {
  const hasOpenAI = Boolean(process.env.OPENAI_API_KEY?.trim());
  const hasGemini = Boolean(process.env.GEMINI_API_KEY?.trim());
  // A hosted choice without its key degrades to local Kokoro rather than failing every reply.
  if (raw === "openai") return hasOpenAI ? "openai" : "kokoro";
  if (raw === "gemini") return hasGemini ? "gemini" : "kokoro";
  if (raw === "kokoro" || raw === "browser") return raw;
  return hasOpenAI ? "openai" : "kokoro";
}

function parseModelList(raw: string | undefined, fallback: string): string[] {
  if (raw === undefined) return [fallback];
  return raw.split(",").map((m) => m.trim()).filter(Boolean);
}

export type LLMProvider = { name: "groq" | "gemini"; baseUrl: string; apiKey: string | undefined };

/** Route a model name to its provider. */
export function providerFor(model: string): LLMProvider {
  return /^gemini-/i.test(model)
    ? { name: "gemini", baseUrl: env.geminiBaseUrl, apiKey: env.geminiApiKey }
    : { name: "groq", baseUrl: env.groqBaseUrl, apiKey: env.groqApiKey };
}

export class ConfigError extends Error {
  constructor(public envVar: string, message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function requireGroqKey(): string {
  if (!env.groqApiKey) {
    throw new ConfigError("GROQ_API_KEY", "GROQ_API_KEY is not configured. Add it to .env and restart the server.");
  }
  return env.groqApiKey;
}

export function sttConfigured() {
  return env.sttProvider === "openai" ? Boolean(env.openaiApiKey) : Boolean(env.groqApiKey);
}

export function getPublicConfigStatus() {
  return {
    llm: {
      configured: Boolean(env.groqApiKey),
      provider: "groq",
      model: env.groqModel,
      fallbackModels: env.fallbackModels.filter((m) => Boolean(providerFor(m).apiKey)),
    },
    stt: {
      configured: sttConfigured(),
      provider: env.sttProvider,
      model: env.sttProvider === "openai" ? "whisper-1" : env.groqSttModel,
      envVar: env.sttProvider === "openai" ? "OPENAI_API_KEY" : "GROQ_API_KEY",
    },
    tts: {
      configured: env.ttsProvider !== "browser",
      provider: env.ttsProvider,
      model:
        env.ttsProvider === "openai" ? env.openaiTtsModel
        : env.ttsProvider === "gemini" ? env.geminiTtsModel
        : env.ttsProvider === "kokoro" ? `Kokoro-82M (${env.kokoroVoice}, local)`
        : "speechSynthesis",
    },
  };
}
