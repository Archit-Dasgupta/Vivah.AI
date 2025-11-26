import { UIMessage } from "ai";
import { useEffect, useRef, useMemo } from "react";
import { UserMessage } from "./user-message";
import { AssistantMessage } from "./assistant-message";
import Image from "next/image";

type Props = {
  messages: UIMessage[];
  status?: string;
  durations?: Record<string, number>;
  onDurationChange?: (key: string, duration: number) => void;
};

type VendorHit = {
  id: string | null;
  name: string | null;
  category?: string | null;
  city?: string | null;
  price_min?: number | null;
  price_max?: number | null;
  is_veg?: boolean | null;
  rating?: number | null;
  contact?: string | null;
  images?: string[] | null;
  short_description?: string | null;
  raw?: any;
};

export function MessageWall({ messages, status, durations, onDurationChange }: Props) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Helper: join UIMessage parts into plain text
  function messageToText(m: UIMessage): string {
    try {
      if (m.parts && Array.isArray(m.parts)) {
        return m.parts.map((p: any) => (p?.type === "text" ? (p.text ?? "") : "")).join("");
      }
      // fallback to `content` if present
      // @ts-ignore
      if (m.content && typeof m.content === "string") return m.content;
      return "";
    } catch (e) {
      return "";
    }
  }

  // Helper: extract JSON sentinel from assistant text
  function extractVendorHitsFromText(text: string): VendorHit[] | null {
    const startToken = "__VENDOR_HITS_JSON__";
    const endToken = "__END_VENDOR_HITS_JSON__";
    const s = text.indexOf(startToken);
    const e = text.indexOf(endToken);
    if (s === -1 || e === -1 || e <= s) return null;
    const jsonStr = text.slice(s + startToken.length, e);
    try {
      const parsed = JSON.parse(jsonStr);
      return Array.isArray(parsed) ? parsed : null;
    } catch (err) {
      // parsing failed
      console.warn("MessageWall: failed to parse vendor JSON sentinel", err);
      return null;
    }
  }

  // Helper: remove sentinel block from text, return trimmed human text
  function stripSentinelFromText(text: string): string {
    const startToken = "__VENDOR_HITS_JSON__";
    const idx = text.indexOf(startToken);
    if (idx === -1) return text;
    return text.slice(0, idx).trim();
  }

  // Emit window events so outer client can handle follow-ups without changing props
  function emitMoreDetails(vendorName: string | null) {
    const ev = new CustomEvent("chat_action_more_details", { detail: { vendorName } });
    window.dispatchEvent(ev);
  }
  function emitReviews(vendorName: string | null) {
    const ev = new CustomEvent("chat_action_reviews", { detail: { vendorName } });
    window.dispatchEvent(ev);
  }

  function VendorCard({ v }: { v: VendorHit }) {
    return (
      <div className="w-full border rounded-lg p-4 bg-white shadow-sm flex gap-4">
        <div className="w-24 h-24 rounded overflow-hidden bg-gray-100 flex-shrink-0">
          {v.images && v.images.length ? (
            // Next/Image requires trusted domains in next.config.js — if failing, replace with <img>
            <Image
              src={v.images[0]}
              alt={v.name ?? "vendor"}
              width={96}
              height={96}
              style={{ objectFit: "cover" }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">No image</div>
          )}
        </div>

        <div className="flex-1">
          <div className="flex justify-between items-start">
            <div>
              <div className="font-semibold text-sm">{v.name}</div>
              <div className="text-xs text-gray-600">{v.category ?? ""} • {v.city ?? ""}</div>
            </div>
            <div className="text-right text-xs">
              {v.rating ? <div className="font-medium">{v.rating}/5</div> : null}
              <div className="text-gray-500">{v.is_veg === true ? "Veg-only" : v.is_veg === false ? "Veg & Non-veg" : ""}</div>
            </div>
          </div>

          {v.short_description ? <div className="mt-2 text-sm text-gray-700">{v.short_description}</div> : null}

          <div className="mt-3 flex gap-2">
            <button
              className="px-3 py-1 rounded bg-[var(--gold-2)] text-white text-sm"
              onClick={() => emitMoreDetails(v.name)}
            >
              More details
            </button>

            <button
              className="px-3 py-1 rounded border text-sm"
              onClick={() => emitReviews(v.name)}
            >
              Reviews
            </button>

            {v.contact && (
              <a className="ml-auto text-sm underline text-[var(--text-maroon)]" href={`tel:${v.contact}`}>
                Call
              </a>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative max-w-3xl w-full">
      <div className="relative flex flex-col gap-4">
        {messages.map((message, messageIndex) => {
          const isLastMessage = messageIndex === messages.length - 1;
          const text = messageToText(message);
          const hits = message.role === "assistant" ? extractVendorHitsFromText(text) : null;
          const humanText = message.role === "assistant" ? stripSentinelFromText(text) : text;

          // Build a shallow clone of the message with parts replaced by humanText so AssistantMessage does not render sentinel
          const safeMessageForAssistant: UIMessage = useMemo(() => {
            if (message.role !== "assistant") return message;
            const clone: any = { ...message };
            clone.parts = [{ type: "text", text: humanText }];
            // remove raw content if any to avoid duplicate display
            // @ts-ignore
            if (clone.content) clone.content = humanText;
            return clone;
            // eslint-disable-next-line react-hooks/exhaustive-deps
          }, [message, humanText]);

          return (
            <div key={message.id} className="w-full">
              {message.role === "user" ? (
                <UserMessage message={message} />
              ) : (
                <>
                  <AssistantMessage
                    message={safeMessageForAssistant}
                    status={status}
                    isLastMessage={isLastMessage}
                    durations={durations}
                    onDurationChange={onDurationChange}
                  />

                  {/* if there are vendor hits, render cards */}
                  {hits && hits.length ? (
                    <div className="mt-3 grid gap-3">
                      {hits.map((h) => (
                        <VendorCard key={h.id ?? h.name ?? Math.random()} v={h as VendorHit} />
                      ))}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          );
        })}

        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
