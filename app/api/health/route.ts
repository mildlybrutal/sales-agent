import { connection } from "next/server";
import { db } from "@/lib/db";
import { env, getPublicConfigStatus } from "@/lib/env";
import { warmKokoro } from "@/lib/tts-kokoro";

/** Reports which integrations are configured (booleans only — never key values). */
export async function GET() {
  await connection();
  // Live Agent calls this on open: start loading the local voice before the first reply needs it.
  if (env.ttsProvider === "kokoro" || env.ttsProvider === "gemini") warmKokoro();
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
