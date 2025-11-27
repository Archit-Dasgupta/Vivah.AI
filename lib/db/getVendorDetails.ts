// lib/db/getVendorDetails.ts
// @ts-nocheck

import { getSupabaseAdmin } from "../supabase"; // adjust path if needed

export async function getVendorDetails(vendorId: string) {
  if (!vendorId) return null;

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    throw new Error(
      "Supabase not configured. Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in Vercel."
    );
  }

  // 1. Vendor core data
  const { data: vendor, error: vendorError } = await supabase
    .from("vendors")
    .select(`
      id, name, category, sub_category,
      short_description, long_description,
      address, city, latitude, longitude,
      phone, email, website,
      min_price, max_price, currency,
      capacity, avg_rating, rating_count
    `)
    .eq("id", vendorId)
    .single();

  if (vendorError || !vendor) {
    console.error("[getVendorDetails] vendor fetch error:", vendorError);
    return null;
  }

  // 2. Images
  const { data: images } = await supabase
    .from("vendor_images")
    .select("id, url, caption, is_main")
    .eq("vendor_id", vendorId)
    .order("is_main", { ascending: false })
    .order("uploaded_at", { ascending: false })
    .limit(10);

  // 3. Offers
  const { data: offers } = await supabase
    .from("vendor_offers")
    .select("id, title, description, price, currency, min_persons, max_persons")
    .eq("vendor_id", vendorId)
    .order("price", { ascending: true })
    .limit(10);

  // 4. Top 5 reviews
  const { data: reviews } = await supabase
    .from("vendor_reviews")
    .select("id, reviewer_name, rating, title, body, review_date, source")
    .eq("vendor_id", vendorId)
    .order("rating", { ascending: false })
    .order("review_ts", { ascending: false })
    .limit(5);

  // 5. Stats
  const review_count = reviews?.length ?? 0;
  const avg_rating =
    review_count > 0
      ? Number(
          (
            reviews.reduce((a, r) => a + (r.rating || 0), 0) / review_count
          ).toFixed(2)
        )
      : vendor.avg_rating || 0;

  return {
    vendor,
    images: images || [],
    offers: offers || [],
    top_reviews: reviews || [],
    stats: {
      review_count,
      avg_rating,
    },
  };
}
