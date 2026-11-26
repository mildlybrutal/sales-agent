/**
 * Retrieval-augmented generation over the EstateAI knowledge base.
 *
 * - Ingestion: KnowledgeDocument → paragraph-aware chunks → embeddings →
 *   KnowledgeChunk.embedding (pgvector, cosine distance).
 * - Retrieval: query embedding → `ORDER BY embedding <=> $1` in Postgres.
 * - Fallback: if the embedding model cannot load (e.g. offline first run),
 *   we fall back to Postgres full-text search and label results
 *   `method: "keyword_fallback"` so it is never mistaken for vector search.
 */
import { db } from "@/lib/db";
import { embed, toVectorLiteral } from "@/lib/embeddings";

export type RetrievalMethod = "vector" | "keyword_fallback";

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  title: string;
  sourceType: string;
  propertyId: string | null;
  content: string;
  score: number;
}

/** Split on blank lines, then pack paragraphs into ~maxChars chunks with one-paragraph overlap. */
export function chunkText(text: string, maxChars = 600): string[] {
  const paras = text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current: string[] = [];
  let len = 0;
  for (const p of paras) {
    if (len + p.length > maxChars && current.length) {
      chunks.push(current.join("\n\n"));
      const last = current[current.length - 1];
      current = last.length < maxChars / 2 ? [last] : [];
      len = current.reduce((s, x) => s + x.length, 0);
    }
    current.push(p);
    len += p.length;
  }
  if (current.length) chunks.push(current.join("\n\n"));
  return chunks;
}

/** (Re)build chunks + embeddings for one document. */
export async function ingestDocument(documentId: string) {
  const doc = await db.knowledgeDocument.findUniqueOrThrow({ where: { id: documentId } });
  const pieces = chunkText(doc.content);
  // Prefix each chunk with its title so short chunks keep their context.
  const vectors = await embed(pieces.map((p) => `${doc.title}\n${p}`));

  await db.$transaction(async (tx) => {
    await tx.knowledgeChunk.deleteMany({ where: { documentId } });
    for (let i = 0; i < pieces.length; i++) {
      await tx.$executeRaw`
        INSERT INTO "KnowledgeChunk" ("id", "documentId", "chunkIndex", "content", "embedding")
        VALUES (gen_random_uuid(), ${documentId}::uuid, ${i}, ${pieces[i]}, ${toVectorLiteral(vectors[i])}::vector)`;
    }
  });
  return pieces.length;
}

export async function retrieve(
  query: string,
  opts: { limit?: number; sourceTypes?: string[] } = {},
): Promise<{ method: RetrievalMethod; results: RetrievedChunk[] }> {
  const limit = Math.min(Math.max(opts.limit ?? 4, 1), 10);
  const sourceTypes = opts.sourceTypes ?? ["PROPERTY_LISTING", "COMPANY_FAQ", "POLICY"];

  let qvec: number[] | null = null;
  try {
    [qvec] = await embed([query]);
  } catch {
    qvec = null;
  }

  if (qvec) {
    const rows = await db.$queryRaw<RetrievedChunk[]>`
      SELECT c."id" AS "chunkId", d."id" AS "documentId", d."title", d."sourceType"::text AS "sourceType",
             d."propertyId", c."content",
             1 - (c."embedding" <=> ${toVectorLiteral(qvec)}::vector) AS "score"
      FROM "KnowledgeChunk" c
      JOIN "KnowledgeDocument" d ON d."id" = c."documentId"
      WHERE c."embedding" IS NOT NULL AND d."sourceType"::text = ANY(${sourceTypes})
      ORDER BY c."embedding" <=> ${toVectorLiteral(qvec)}::vector
      LIMIT ${limit}`;
    return { method: "vector", results: rows.map((r) => ({ ...r, score: Number(r.score) })) };
  }

  const rows = await db.$queryRaw<RetrievedChunk[]>`
    SELECT c."id" AS "chunkId", d."id" AS "documentId", d."title", d."sourceType"::text AS "sourceType",
           d."propertyId", c."content",
           ts_rank(to_tsvector('english', d."title" || ' ' || c."content"), plainto_tsquery('english', ${query})) AS "score"
    FROM "KnowledgeChunk" c
    JOIN "KnowledgeDocument" d ON d."id" = c."documentId"
    WHERE d."sourceType"::text = ANY(${sourceTypes})
      AND to_tsvector('english', d."title" || ' ' || c."content") @@ plainto_tsquery('english', ${query})
    ORDER BY "score" DESC
    LIMIT ${limit}`;
  return { method: "keyword_fallback", results: rows.map((r) => ({ ...r, score: Number(r.score) })) };
}

export function propertyDocumentText(p: {
  name: string;
  location: string;
  address: string;
  priceInr: number;
  bedrooms: number;
  propertyType: string;
  areaSqft: number;
  amenities: string[];
  availability: string;
  unitsAvailable: number;
  developer: string;
  description: string;
}) {
  return [
    `${p.name} is a ${p.bedrooms}BHK ${p.propertyType.toLowerCase().replace("_", " ")} in ${p.location}, Pune, by ${p.developer}. Address: ${p.address}.`,
    `Price: ₹${p.priceInr.toLocaleString("en-IN")}. Carpet area: ${p.areaSqft} sq ft. Availability: ${p.availability}. Units available: ${p.unitsAvailable}.`,
    `Amenities: ${p.amenities.join(", ")}.`,
    p.description,
  ].join("\n\n");
}
