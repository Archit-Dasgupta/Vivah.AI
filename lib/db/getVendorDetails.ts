// lib/db/getVendorDetails.ts
import { supabaseAdmin } from "../supabase";

export async function getVendorDetails(id: string) {
  if (!id) return null;

  // vendor core
  const { data: vendor } = await supabaseAdmin
    .from("vendors")
    .select("*")
    .eq("id", id)
    .single();

  if (!vendor) return null;

  // images
  const { data: images } = await supabaseAdmin
    .from("vendor_images")
    .select("url, caption, is_main")
    .eq("vendor_id", id)
    .order("is_main", { ascending: false })
    .order("uploaded_at", { ascending: false });

  // offers
  const { data: offers } = await supabaseAdmin
    .from("vendor_offers")
    .select("*")
    .eq("vendor_id", id);

  // reviews
  const { data: reviews } = await supabaseAdmin
    .from("vendor_reviews")
    .select("*")
    .eq("vendor_id", id)
    .order("review_ts", { ascending: false })
    .limit(50);

  return {
    vendor,
    images: images || [],
    offers: offers || [],
    reviews: reviews || [],
  };
}
