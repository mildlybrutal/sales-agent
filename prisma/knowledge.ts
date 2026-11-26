import { db } from "../lib/db";
import { COMPANY_DOCS, PROPERTIES } from "../lib/data/properties";
import { ingestDocument, propertyDocumentText } from "../lib/rag";

export async function upsertProperties() {
  for (const p of PROPERTIES) {
    await db.property.upsert({ where: { slug: p.slug }, create: p, update: p });
  }
  return PROPERTIES.length;
}

/** Rebuild the knowledge base: one document per listing + company docs, chunked and embedded. */
export async function rebuildKnowledgeBase() {
  await db.knowledgeDocument.deleteMany({});
  const properties = await db.property.findMany();
  const docs = [
    ...properties.map((p) => ({ title: `${p.name}, ${p.location}`, sourceType: "PROPERTY_LISTING" as const, propertyId: p.id, content: propertyDocumentText(p) })),
    ...COMPANY_DOCS.map((d) => ({ ...d, propertyId: null })),
  ];
  let chunks = 0;
  for (const d of docs) {
    const doc = await db.knowledgeDocument.create({ data: d });
    chunks += await ingestDocument(doc.id);
  }
  return { documents: docs.length, chunks };
}
