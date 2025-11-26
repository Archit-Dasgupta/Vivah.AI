// app/api/chat/route.ts
// @ts-nocheck
import {
  streamText,
  UIMessage,
  convertToModelMessages,
  stepCountIs,
  createUIMessageStream,
  createUIMessageStreamResponse,
} from "ai";

import { MODEL } from "@/config";
import { SYSTEM_PROMPT } from "@/prompts";
import { isContentFlagged } from "@/lib/moderation";
import { webSearch } from "./tools/web-search";
import { vectorDatabaseSearch } from "./tools/search-vector-database";

/**
 * Chat handler (app router)
 *
 * Notes:
 * - This handler accepts either { messages: UIMessage[] } or { message: string } payloads.
 * - Vendor mode short-circuits to a direct vector DB query and streams a friendly vendor list.
 */

export const maxDuration = 30;

function getLatestUserText(messages: UIMessage[]): string | null {
  const latestUserMessage = messages?.filter((m) => m.role === "user").pop();
  if (!latestUserMessage) return null;

  const textParts = latestUserMessage.parts
    .filter((p: any) => p.type === "text")
    .map((part: any) => ("text" in part ? part.text : ""))
    .join("");

  return textParts || null;
}

function isVendorQuery(text: string | null): boolean {
  if (!text) return false;
  const t = text.toLowerCase();

  const vendorKeywords = [
    "vendor",
    "vendors",
    "caterer",
    "caterers",
    "venue",
    "venues",
    "wedding",
    "photographer",
    "photographers",
    "makeup",
    "decorator",
    "decor",
    "dj",
    "banquet",
  ];
  const cityKeywords = ["mumbai", "bombay"];

  return vendorKeywords.some((k) => t.includes(k)) || cityKeywords.some((c) => t.includes(c));
}

type IncomingBody =
  | { messages?: UIMessage[]; [k: string]: any }
  | { message?: string; [k: string]: any };

export async function POST(req: Request) {
  console.log("[chat] request received");

  let body: IncomingBody;
  try {
    body = (await req.json()) as IncomingBody;
  } catch (err) {
    console.error("[chat] failed to parse JSON body:", err);
    return new Response(JSON.stringify({ error: "invalid JSON body" }), { status: 400 });
  }

  // normalize messages: accept { messages } or { message }
  let messages: UIMessage[] | undefined = undefined;
  if (Array.isArray((body as any).messages)) {
    messages = (body as any).messages as UIMessage[];
  } else if (typeof (body as any).message === "string") {
    // create a minimal UIMessage array
    messages = [
      {
        id: "m1",
        role: "user",
        parts: [{ type: "text", text: (body as any).message }],
      } as any,
    ];
  } else {
    // If nothing provided, reject
    console.error("[chat] no messages or message found in request body:", body);
    return new Response(JSON.stringify({ error: "no messages provided" }), { status: 400 });
  }

  const latestUserText = getLatestUserText(messages) ?? "";
  console.log("[chat] latestUserText:", latestUserText?.slice(0, 300));

  // ---------- Moderation ----------
  try {
    if (latestUserText) {
      const moderationResult = await isContentFlagged(latestUserText);
      console.log("[chat] moderation result:", moderationResult);

      if (moderationResult?.flagged) {
        // stream a single moderation denial message
        const stream = createUIMessageStream({
          execute({ writer }) {
            const textId = "moderation-denial-text";
            writer.write({ type: "start" });
            writer.write({ type: "text-start", id: textId });
            writer.write({
              type: "text-delta",
              id: textId,
              delta:
                moderationResult.denialMessage ||
                "Your message violates our guidelines. I can't answer that.",
            });
            writer.write({ type: "text-end", id: textId });
            writer.write({ type: "finish" });
          },
        });

        return createUIMessageStreamResponse({ stream });
      }
    }
  } catch (modErr) {
    console.error("[chat] moderation check failed, continuing anyway:", modErr);
    // proceed — moderation failures shouldn't permanently break chat
  }

  // ---------- Vendor mode (direct search) ----------
  const vendorMode = isVendorQuery(latestUserText);
  if (vendorMode) {
    console.log("[chat] entering vendor mode");

    const stream = createUIMessageStream({
      async execute({ writer }) {
        const textId = "vendor-response";
        writer.write({ type: "start" });
        writer.write({ type: "text-start", id: textId });

        try {
          // Use only the latest user message to form the query (prevents repetition)
          const composedQuery = (latestUserText || "").trim();
          console.log("[chat][vendor mode] composedQuery:", composedQuery);

          // Call the vector DB tool; tolerate different interfaces.
          let result: any;
          try {
            // preferred shape: execute({ query, topK })
            result = await (vectorDatabaseSearch as any).execute?.({
              query: composedQuery,
              topK: 8,
            });
          } catch (e1) {
            console.warn("[chat] vectorDatabaseSearch.execute failed, trying fallback interface", e1);
            try {
              // fallback: vectorDatabaseSearch(query, topK)
              result = await (vectorDatabaseSearch as any)(composedQuery, 8);
            } catch (e2) {
              console.error("[chat] both vector search attempts failed:", e2);
              throw e2;
            }
          }

          // Debug: print raw result for inspection in logs
          try {
            const raw = JSON.stringify(result, null, 2);
            console.log("[chat][vendor mode] raw vector result:", raw.slice(0, 10000));
          } catch (jerr) {
            console.log("[chat][vendor mode] raw vector result (non-serializable)", result);
          }

          // Normalize vendor list from multiple possible shapes:
          let vendors: any[] = [];

          if (Array.isArray(result?.vendors) && result.vendors.length) {
            vendors = result.vendors;
          } else if (Array.isArray(result?.results) && result.results.length) {
            vendors = result.results;
          } else if (Array.isArray(result?.items) && result.items.length) {
            vendors = result.items;
          } else if (Array.isArray(result?.matches) && result.matches.length) {
            vendors = result.matches.map((m: any) => ({
              ...(m.metadata ?? {}),
              _score: m.score ?? m.similarity ?? undefined,
              _id: m.id ?? undefined,
            }));
          } else if (Array.isArray(result?.hits) && result.hits.length) {
            vendors = result.hits.map((h: any) => ({
              ...(h.document ?? h.payload ?? h.metadata ?? h),
              _score: h.score ?? h._score ?? undefined,
              _id: h.id ?? undefined,
            }));
          } else if (Array.isArray(result) && result.length) {
            vendors = result;
          } else {
            vendors = [];
          }

          vendors = vendors.filter(Boolean);

          if (!vendors || vendors.length === 0) {
            writer.write({
              type: "text-delta",
              id: textId,
              delta: `I couldn’t find any vendors in my database for that request. I searched for: "${composedQuery}".\n\nYou can: 1) specify a neighbourhood (e.g., "Powai"), 2) give a budget, 3) allow me to search the web for vendor options, or 4) add vendors to the database.`,
            });
          } else {
            const lines = vendors.slice(0, 8).map((v: any, idx: number) => {
              const name = v.name ?? v.title ?? v.vendor_name ?? v.provider ?? "Unnamed vendor";
              const category =
                v.category ??
                v.vendor_type ??
                v.sub_category ??
                v.type ??
                v.tag ??
                "Vendor";
              const city = v.city ?? v.location ?? v.town ?? "Mumbai";
              let price = "";
              if (v.price_range) {
                price = `, approx ${v.price_range}`;
              } else if (v.min_price || v.max_price) {
                const mn = v.min_price ?? "";
                const mx = v.max_price ?? "";
                price = `, approx ${mn}${mn && mx ? "-" : ""}${mx}`.replace(/(^, )|(^, $)/, "");
              }
              let contact = v.phone ?? v.contact ?? (v.metadata && v.metadata.phone) ?? "";
              if (contact) contact = `, contact: ${contact}`;
              return `${idx + 1}. ${name} – ${category}, ${city}${price}${contact}`;
            });

            const header = `Here are some vendors I found for "${composedQuery}":\n\n`;
            writer.write({ type: "text-delta", id: textId, delta: header + lines.join("\n") });
          }
        } catch (err) {
          console.error("[chat][vendor mode] error:", err);
          writer.write({
            type: "text-delta",
            id: textId,
            delta: "Something went wrong while fetching vendors. Please try again in a moment, or ask me to search the web for vendor options.",
          });
        } finally {
          try {
            writer.write({ type: "text-end", id: textId });
          } catch (e) {
            /* ignore */
          }
          try {
            writer.write({ type: "finish" });
          } catch (e) {
            /* ignore */
          }
        }
      },
    });

    return createUIMessageStreamResponse({ stream });
  }

  // ---------- Normal mode: stream a normal LLM response ----------
  try {
    console.log("[chat] entering normal mode; streaming to model:", MODEL);

    const result = streamText({
      model: MODEL,
      system: SYSTEM_PROMPT,
      messages: convertToModelMessages(messages),
      tools: { webSearch }, // keep tool mapping; ensure webSearch implements expected interface
      stopWhen: stepCountIs(10),
      providerOptions: {
        openai: {
          reasoningSummary: "auto",
          reasoningEffort: "low",
          parallelToolCalls: false,
        },
      },
    });

    return result.toUIMessageStreamResponse({
      sendReasoning: true,
    });
  } catch (err) {
    console.error("[chat] normal-mode streaming error:", err);
    // graceful fallback single message
    const stream = createUIMessageStream({
      execute({ writer }) {
        const textId = "fallback-response";
        writer.write({ type: "start" });
        writer.write({ type: "text-start", id: textId });
        writer.write({
          type: "text-delta",
          id: textId,
          delta:
            "Sorry — I'm having trouble generating a reply right now. Please try again in a few seconds.",
        });
        writer.write({ type: "text-end", id: textId });
        writer.write({ type: "finish" });
      },
    });

    return createUIMessageStreamResponse({ stream });
  }
}
