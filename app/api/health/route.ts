import { connection } from "next/server";
import { db } from "@/lib/db";
import { getPublicConfigStatus } from "@/lib/env";

/** Reports which integrations are configured (booleans only — never key values). */
export async function GET() {
  await connection();
  let database = { ok: false, vectorChunks: 0, properties: 0 };
  try {
    const [props, chunks] = await Promise.all([
      db.property.count(),
      db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "KnowledgeChunk" WHERE "embedding" IS NOT NULL`,
    ]);
    database = { ok: true, properties: props, vectorChunks: Number(chunks[0]?.n ?? 0) };
  } catch {
    // leave ok=false
  }
  return Response.json({ database, ...getPublicConfigStatus() });
}
