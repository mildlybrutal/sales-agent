import "dotenv/config";
import { db } from "../lib/db";
import { rebuildKnowledgeBase, upsertProperties } from "./knowledge";

async function main() {
  console.log(`Upserted ${await upsertProperties()} properties`);
  const t = Date.now();
  const { documents, chunks } = await rebuildKnowledgeBase();
  console.log(`Ingested ${documents} documents → ${chunks} embedded chunks in ${Date.now() - t} ms`);
}

main().finally(() => db.$disconnect());
