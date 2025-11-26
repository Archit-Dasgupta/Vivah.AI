// app/api/vendor/[id]/route.ts
import { NextResponse } from "next/server";
// route file is at: app/api/vendor/[id]/route.ts
// lib is at: /lib/supabase.ts (project root)
// relative path from this file to lib => ../../../../lib/...
import { supabaseAdmin } from "../../../../lib/supabase";

/**
 * GET /api/vendor/:id
 * Returns canonical vendor row plus images, offers and recent reviews.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const id = params?.id;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  try {
    // 1) Fetch vendor main record
    const { data: vendor, error: vendorErr } = await supabaseAdmin
      .from("vendors")
      .select("*")
      .eq("id", id)
      .single();

    if (vendorErr || !vendor) {
      return NextResponse.json({ error: vendorErr?.message || "vendor not found" }, { status: 404 });
    }

    // 2) Fetch related content in parallel
    const [imagesRes, offersRes, reviewsRes] = await Promise.all([
      supabaseAdmin
        .from("vendor_images")
        .select("*")
        .eq("vendor_id", id)
        .order("uploaded_at", { ascending: false })
        .limit(12),
      supabaseAdmin
        .from("vendor_offers")
        .select("*")
        .eq("vendor_id", id)
        .order("updated_at", { ascending: false })
        .limit(10),
      supabaseAdmin
        .from("vendor_reviews")
        .select("*")
        .eq("vendor_id", id)
        .order("scraped_at", { ascending: false })
        .limit(8),
    ]);

    return NextResponse.json({
      vendor,
      images: imagesRes.data || [],
      offers: offersRes.data || [],
      reviews: reviewsRes.data || [],
    });
  } catch (err: any) {
    console.error("api/vendor error:", err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
