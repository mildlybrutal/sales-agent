/**
 * Local sentence embeddings (all-MiniLM-L6-v2, 384 dims) via transformers.js.
 * Runs in-process on CPU; the ONNX model is downloaded once and cached.
 * Used both by the ingestion script and by query-time retrieval, so the
 * vector space is identical on both sides.
 */
import type { FeatureExtractionPipeline } from "@huggingface/transformers";

export const EMBEDDING_DIMS = 384;

const g = globalThis as unknown as { __embedder?: Promise<FeatureExtractionPipeline> };

function getEmbedder(): Promise<FeatureExtractionPipeline> {
  if (!g.__embedder) {
    const model = process.env.EMBEDDING_MODEL?.trim() || "Xenova/all-MiniLM-L6-v2";
    g.__embedder = import("@huggingface/transformers").then(
      ({ pipeline }) => pipeline("feature-extraction", model, { dtype: "fp32" }) as Promise<FeatureExtractionPipeline>,
    );
    // Allow a retry on the next call if loading failed (e.g. offline first run).
    g.__embedder.catch(() => {
      g.__embedder = undefined;
    });
  }
  return g.__embedder;
}

export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const extractor = await getEmbedder();
  const output = await extractor(texts, { pooling: "mean", normalize: true });
  return output.tolist() as number[][];
}

/** pgvector literal, e.g. "[0.1,0.2,...]" — passed as a bound parameter. */
export function toVectorLiteral(v: number[]): string {
  return `[${v.map((x) => (Number.isFinite(x) ? x.toFixed(6) : "0")).join(",")}]`;
}
