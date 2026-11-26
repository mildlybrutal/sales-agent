import "server-only";

/**
 * Server-only access to configuration. Keys never leave the server; the client
 * only ever sees the boolean `configured` flags from getPublicConfigStatus().
 */
export const env = {
  groqApiKey: process.env.GROQ_API_KEY?.trim() || undefined,
  groqBaseUrl: (process.env.GROQ_BASE_URL?.trim() || "https://api.groq.com/openai/v1").replace(/\/$/, ""),
  groqModel: process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b",
  /** Used when GROQ_MODEL is rate limited (Groq limits are per model). Set to "" to disable. */
  groqFallbackModel: process.env.GROQ_FALLBACK_MODEL?.trim() ?? "openai/gpt-oss-20b",
  /** End-of-call summaries run here so they don't consume the conversation model's quota. */
  groqSummaryModel: process.env.GROQ_SUMMARY_MODEL?.trim() || "openai/gpt-oss-20b",
  groqSttModel: process.env.GROQ_STT_MODEL?.trim() || "whisper-large-v3-turbo",
  openaiApiKey: process.env.OPENAI_API_KEY?.trim() || undefined,
  openaiTtsModel: process.env.OPENAI_TTS_MODEL?.trim() || "gpt-4o-mini-tts",
  openaiTtsVoice: process.env.OPENAI_TTS_VOICE?.trim() || "alloy",
  sttProvider: (process.env.STT_PROVIDER?.trim() === "openai" ? "openai" : "groq") as "groq" | "openai",
  embeddingModel: process.env.EMBEDDING_MODEL?.trim() || "Xenova/all-MiniLM-L6-v2",
};

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
    llm: { configured: Boolean(env.groqApiKey), provider: "groq", model: env.groqModel },
    stt: {
      configured: sttConfigured(),
      provider: env.sttProvider,
      model: env.sttProvider === "openai" ? "whisper-1" : env.groqSttModel,
      envVar: env.sttProvider === "openai" ? "OPENAI_API_KEY" : "GROQ_API_KEY",
    },
    tts: {
      configured: Boolean(env.openaiApiKey),
      provider: env.openaiApiKey ? "openai" : "browser",
      model: env.openaiApiKey ? env.openaiTtsModel : "speechSynthesis",
    },
  };
}
