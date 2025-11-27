import React from "react";

type MessagePart =
  | { type: "text"; text: string }
  | { type: "tool-result"; tool: string; result: any }
  | { type: string; [k: string]: any };

type UIMessage = {
  id?: string;
  role: "user" | "assistant" | "system";
  parts?: MessagePart[];
  // for backward compatibility, sometimes message may be a plain string
  text?: string;
};

type VendorHit = {
  id?: string | number | null;
  name?: string | null;
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

type Props = {
  messages: UIMessage[];
  // optional: small render config
  maxCards?: number;
};

export default function MessageWall({ messages, maxCards = 6 }: Props) {
  // Helper: combine text parts into a single string
  function messageToText(m: UIMessage): string {
    if (!m) return "";
    // prefer parts if present
    if (Array.isArray(m.parts)) {
      return m.parts
        .filter((p) => p.type === "text" && typeof (p as any).text === "string")
        .map((p) => (p as any).text)
        .join("");
    }
    // fallback fields
    if (typeof (m as any).text === "string") return (m as any).text;
    return "";
  }

  // Parse sentinel JSON from text: __VENDOR_HITS_JSON__{...}__END_VENDOR_HITS_JSON__
  function extractVendorHitsFromText(text: string): VendorHit[] | null {
    if (!text) return null;
    const re = /__VENDOR_HITS_JSON__([\s\S]*?)__END_VENDOR_HITS_JSON__/m;
    const m = text.match(re);
    if (!m) return null;
    try {
      const parsed = JSON.parse(m[1]);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray(parsed.result)) return parsed.result;
      return null;
    } catch (e) {
      console.warn("Failed to parse vendor hits sentinel JSON:", e);
      return null;
    }
  }

  // Strip any sentinel JSON blocks out of assistant text for display
  function stripSentinelFromText(text: string): string {
    if (!text) return "";
    // remove vendor hits / details / reviews sentinels
    const sentinelRegex = /(__VENDOR_HITS_JSON__[\s\S]*?__END_VENDOR_HITS_JSON__)|(__VENDOR_DETAILS_JSON__[\s\S]*?__END_VENDOR_DETAILS_JSON__)|(__VENDOR_REVIEWS_JSON__[\s\S]*?__END_VENDOR_REVIEWS_JSON__)|(__GUIDE_JSON___[\s\S]*?___END_GUIDE_JSON___)/g;
    return text.replace(sentinelRegex, "").trim();
  }

  // Dispatch events so existing UI handlers can act (details panel, reviews panel)
  function emitVendorDetailsEvent(payload: any) {
    try {
      window.dispatchEvent(new CustomEvent("vendor_details", { detail: payload }));
    } catch (e) {
      console.warn("emitVendorDetailsEvent failed", e);
    }
  }
  function emitVendorReviewsEvent(payload: any) {
    try {
      window.dispatchEvent(new CustomEvent("vendor_reviews", { detail: payload }));
    } catch (e) {
      console.warn("emitVendorReviewsEvent failed", e);
    }
  }

  // Render a simple vendor card. Keep styling minimal - adapt to your CSS framework.
  function VendorCard({ vendor }: { vendor: VendorHit }) {
    const img = Array.isArray(vendor.images) && vendor.images.length ? vendor.images[0] : null;
    const priceStr =
      vendor.price_min || vendor.price_max
        ? `₹${vendor.price_min ?? "NA"} - ₹${vendor.price_max ?? "NA"}`
        : vendor.raw?.price_range || "Price not provided";

    return (
      <div
        style={{
          display: "flex",
          gap: 16,
          alignItems: "flex-start",
          border: "1px solid #b86d3b",
          borderRadius: 8,
          padding: 12,
          marginBottom: 12,
          background: "#fff",
        }}
      >
        <div style={{ width: 96, height: 96, flexShrink: 0, background: "#f2f2f2", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
          {img ? (
            <img src={img} alt={vendor.name ?? "vendor image"} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <div style={{ color: "#8a8a8a", fontSize: 12 }}>No image</div>
          )}
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, color: "#6b1f11" }}>{vendor.name ?? "Vendor"}</div>
              <div style={{ fontSize: 12, color: "#666" }}>{vendor.category ?? ""} • {vendor.city ?? ""}</div>
            </div>
            <div style={{ fontSize: 12, color: "#444" }}>{vendor.rating ? `${vendor.rating}/5` : null}</div>
          </div>

          <div style={{ marginTop: 8, color: "#333" }}>{vendor.short_description ?? (vendor.raw?.short_description ?? "")}</div>
          <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={() => emitVendorDetailsEvent(vendor)}
              style={{ padding: "6px 12px", borderRadius: 18, border: "none", background: "#c78e2a", color: "#fff", cursor: "pointer" }}
            >
              More details
            </button>
            <button
              onClick={() =>
                emitVendorReviewsEvent({
                  vendor_id: vendor.id ?? vendor.raw?.id,
                  vendor_name: vendor.name,
                })
              }
              style={{ padding: "6px 12px", borderRadius: 18, border: "none", background: "#c78e2a", color: "#fff", cursor: "pointer" }}
            >
              Reviews
            </button>

            <div style={{ marginLeft: "auto", fontSize: 12, color: "#666" }}>{priceStr}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {messages.map((m, mi) => {
        const rawText = messageToText(m);
        // Prefer structured tool-result parts:
        let vendorHits: VendorHit[] | null = null;
        let vendorDetailsPayload: any = null;
        let vendorReviewsPayload: any = null;

        if (Array.isArray(m.parts)) {
          for (const part of m.parts as MessagePart[]) {
            if (part.type === "tool-result" && (part as any).tool === "vendor_hits" && Array.isArray((part as any).result)) {
              vendorHits = (part as any).result.slice(0, maxCards) as VendorHit[];
              // we prefer the explicit structured hits; stop here
              break;
            }
          }
          // capture details / reviews even if hits is present (so we can dispatch on render)
          for (const part of m.parts as MessagePart[]) {
            if (part.type === "tool-result" && (part as any).tool === "vendor_details" && (part as any).result) {
              vendorDetailsPayload = (part as any).result;
            }
            if (part.type === "tool-result" && (part as any).tool === "vendor_reviews" && (part as any).result) {
              vendorReviewsPayload = (part as any).result;
            }
          }
        }

        // Fallback: sentinel JSON embedded in text
        if (!vendorHits) {
          vendorHits = extractVendorHitsFromText(rawText);
          if (vendorHits && vendorHits.length > maxCards) vendorHits = vendorHits.slice(0, maxCards);
        }

        // Human-visible text should have sentinels removed
        const humanText = m.role === "assistant" ? stripSentinelFromText(rawText) : rawText;

        // If a tool-result payload exists for details/reviews, dispatch immediately so UI can show panels
        // (This can be adapted - we dispatch once when we render the assistant message)
        React.useEffect(() => {
          if (vendorDetailsPayload) emitVendorDetailsEvent(vendorDetailsPayload);
          if (vendorReviewsPayload) emitVendorReviewsEvent(vendorReviewsPayload);
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [mi]); // run once per message render

        return (
          <div key={m.id ?? mi} style={{ marginBottom: 18 }}>
            {/* Human text bubble */}
            {humanText ? (
              <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6, color: m.role === "assistant" ? "#4b2a26" : "#222", padding: "6px 2px" }}>
                {humanText}
              </div>
            ) : null}

            {/* Vendor cards area (if present) */}
            {vendorHits && vendorHits.length ? (
              <div style={{ marginTop: 12 }}>
                {vendorHits.map((v, i) => (
                  <VendorCard key={v.id ?? i} vendor={v} />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
