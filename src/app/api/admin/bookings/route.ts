import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabaseAdmin = createClient(url, serviceKey);

  const { searchParams } = new URL(req.url);
  const status = (searchParams.get("status") || "pending") as
    | "pending"
    | "confirmed"
    | "rejected"
    | "all";
  const q = (searchParams.get("q") || "").trim();

  let query = supabaseAdmin
    .from("bookings")
    .select(`
      id, created_at, renter_name, renter_phone, total_amount,
      slip_url, ref_number, status,
      concert_sessions:session_id (
        start_at, note,
        concerts:concert_id ( title, venue_name )
      ),
      phones:phone_id ( model_name )
    `)
    .order("created_at", { ascending: false });

  if (status !== "all") query = query.eq("status", status);

  if (q) {
    query = query.or(
      `ref_number.ilike.%${q}%,renter_name.ilike.%${q}%,renter_phone.ilike.%${q}%`
    );
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    { bookings: data ?? [] },
    { headers: { "Cache-Control": "no-store" } }
  );
}