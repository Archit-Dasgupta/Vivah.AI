// app/api/chat/tools/search-vector-database.ts
// @ts-nocheck
import OpenAI from "openai";
import { Pinecone } from "@pinecone-database/pinecone";

/**
 * Robust Pinecone search helper
 *
 * Exports:
 * - export const vectorDatabaseSearch = { execute: async ({query, topK}) => {...} }
 * - export default async function (query, topK) { return vectorDatabaseSearch.execute({query, topK}) }
 *
 * This ensures compatibility with both `vectorDatabaseSearch.execute({...})` and `vectorDatabaseSearch(query, topK)` calls.
 */

// --- Configuration ---
// Use the same embedding model you used at ingestion.
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const PINECONE_ENV = process.env.PINECONE_ENV || process.env.PINECONE_ENVIRONMENT;
const PINECONE_INDEX_NAME = process.env.PINECONE_INDEX_NAME || process.env.PINECONE_INDEX || "vendors";

if (!OPENAI_API_KEY) console.error("[search-tool] MISSING OPENAI_API_KEY in env");
if (!PINECONE_API_KEY) console.error("[search-tool] MISSING PINECONE_API_KEY in env");
if (!PINECONE_ENV) console.error("[search-tool] MISSING PINECONE_ENV in env");
if (!PINECONE_INDEX_NAME) console.error("[search-tool] MISSING PINECONE_INDEX_NAME in env");

// --- Clients ---
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const pinecone = new Pinecone({ apiKey: PINECONE_API_KEY, environment: PINECONE_ENV });
const index = pinecone.index(PINECONE_INDEX_NAME);

/**
 * Create embedding for text query
 */
async function embedText(text: string) {
  if (!text) return null;
  try {
    const res = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text,
    });
    const emb = res?.data?.[0]?.embedding;
    if (!emb) {
      console.warn("[search-tool] embedding response missing embedding vector");
    }
    return emb;
  } catch (err) {
    console.error("[search-tool] embedding error:", err);
    throw err;
  }
}

/**
 * Normalize Pinecone match into vendor object
 */
function normalizeMatch(m) {
  return {
    id: m.id,
    _score: m.score ?? m.similarity ?? m?.metadata?.score,
    // metadata fields often vary; include widely used names
    name: m.metadata?.name ?? m.metadata?.title ?? m.metadata?.vendor_name ?? "",
    location: m.metadata?.location ?? m.metadata?.city ?? "",
    category: m.metadata?.category ?? m.metadata?.vendor_type ?? m.metadata?.type ?? "",
    price_range: m.metadata?.price_range ?? m.metadata?.price ?? "",
    description: m.metadata?.description ?? m.metadata?.desc ?? "",
    raw_metadata: m.metadata ?? {},
  };
}

/**
 * Main execute function: returns { matches, vendors }
 */
export const vectorDatabaseSearch = {
  async execute({ query, topK = 8 } = {}) {
    console.log("[search-tool] execute called with query:", String(query).slice(0, 300), "topK:", topK);

    if (!query) {
      console.log("[search-tool] empty query -> returning empty results");
      return { matches: [], vendors: [] };
    }

    try {
      // 1) embed
      const embedding = await embedText(query);
      if (!embedding) {
        console.warn("[search-tool] embedding unsuccessful, returning empty");
        return { matches: [], vendors: [] };
      }
      console.log("[search-tool] embedding vector length:", embedding.length);

      // 2) pinecone query
      const pineRes = await index.query({
        vector: embedding,
        topK,
        includeMetadata: true,
        includeValues: false,
      });

      // log raw response (trim to avoid huge logs)
      try {
        const raw = JSON.stringify(pineRes, null, 2);
        console.log("[search-tool] pinecone.raw:", raw.slice(0, 20000));
      } catch (jerr) {
        console.log("[search-tool] pinecone.raw (non-serializable)", pineRes);
      }

      const matches = (pineRes?.matches ?? []).map((m) => ({
        id: m.id,
        score: m.score ?? m.similarity ?? null,
        metadata: m.metadata ?? {},
      }));

      // build vendor objects (metadata-first)
      const vendors = matches.map((m) => {
        // If metadata already contains full vendor record, use it; otherwise normalize.
        const md = m.metadata ?? {};
        const vendorFromMeta = {
          ...md,
          _id: m.id,
          _score: m.score ?? null,
        };
        // ensure basic fields exist
        return {
          name: vendorFromMeta.name ?? vendorFromMeta.title ?? vendorFromMeta.vendor_name ?? normalizeMatch({ metadata: md }).name,
          location: vendorFromMeta.location ?? vendorFromMeta.city ?? normalizeMatch({ metadata: md }).location,
          category: vendorFromMeta.category ?? vendorFromMeta.vendor_type ?? normalizeMatch({ metadata: md }).category,
          price_range: vendorFromMeta.price_range ?? vendorFromMeta.price ?? normalizeMatch({ metadata: md }).price_range,
          description: vendorFromMeta.description ?? vendorFromMeta.desc ?? "",
          _id: vendorFromMeta._id,
          _score: vendorFromMeta._score,
          raw: md,
        };
      });

      return { matches, vendors };
    } catch (err) {
      console.error("[search-tool] Vector DB Search Error:", err);
      return { matches: [], vendors: [] };
    }
  },
};

/**
 * Default callable shape for backward compatibility:
 * vectorDatabaseSearch(query, topK)
 */
export default async function vectorDatabaseSearchFn(query: string, topK = 8) {
  return vectorDatabaseSearch.execute({ query, topK });
}
