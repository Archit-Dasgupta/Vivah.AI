// app/api/chat/route.ts
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
 * - This handler is defensive: it accepts either { messages: UIMessage[] } or { message: string } payloads.
 * - It logs at key points so you can view Vercel function logs to debug.
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
          // call the vector DB tool. We tolerate different tool interfaces by trying a couple of common names.
          let result: any;
          try {
            // preferred shape: execute({ query, topK })
            result = await (vectorDatabaseSearch as any).execute({
              query: latestUserText,
              topK: 5,
            });
          } catch (e1) {
            console.warn("[chat] vectorDatabaseSearch.execute failed, trying fallback interface", e1);
            // fallback: vectorDatabaseSearch({ q, topK })
            try {
              result = await (vectorDatabaseSearch as any)(latestUserText, 5);
            } catch (e2) {
              console.error("[chat] both vector search attempts failed:", e2);
              throw e2;
            }
          }

          const vendors = (result?.vendors ?? result?.results ?? []) as any[];

          if (!vendors || vendors.length === 0) {
            writer.write({
              type: "text-delta",
              id: textId,
              delta:
                "I couldn’t find any vendors in my database for that request. Try specifying the type of vendor (e.g., photographers, caterers) or a different area in Mumbai.",
            });
          } else {
            // format each vendor defensively (city vs location, price_range vs min/max)
            const lines = vendors.slice(0, 5).map((v: any, idx: number) => {
              const name = v.name ?? v.title ?? "Unnamed vendor";
              const category = v.category ?? v.sub_category ?? "Vendor";
              const city = v.city ?? v.location ?? "Mumbai";
              let price = "";
              if (v.price_range) {
                price = `, approx ${v.price_range}`;
              } else if (v.min_price || v.max_price) {
                const mn = v.min_price ?? "";
                const mx = v.max_price ?? "";
                price = `, approx ${mn}${mn && mx ? "-" : ""}${mx}`.replace(/(^, )|(^, $)/, "");
              }
              return `${idx + 1}. ${name} – ${category}, ${city}${price}`;
            });

            const header = "Here are some vendors based on your request:\n\n";
            writer.write({ type: "text-delta", id: textId, delta: header + lines.join("\n") });
          }
        } catch (err) {
          console.error("[chat][vendor mode] error:", err);
          writer.write({
            type: "text-delta",
            id: textId,
            delta: "Something went wrong while fetching vendors. Please try again in a moment.",
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
      // Optional: you can add `maxExecutionTime: maxDuration * 1000` if your ai SDK supports it.
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
