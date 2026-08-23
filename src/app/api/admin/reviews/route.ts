import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/admin/reviews — แอดมินดูรีวิวทั้งหมดที่ลูกค้าส่งมา (รวมที่ยังไม่เผยแพร่)
export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "missing env" }, { status: 500 });
  }

  const supabase = createClient(url, serviceKey);
  const { data, error } = await supabase
    .from("reviews")
    .select("id, booking_id, concert_title, display_name, rating, comment, is_published, created_at")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(
    { reviews: data ?? [] },
    { headers: { "Cache-Control": "no-store" } }
  );
}
