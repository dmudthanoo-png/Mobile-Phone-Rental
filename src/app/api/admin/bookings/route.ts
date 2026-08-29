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
      slip_url, ref_number, status, qty, add_lens, lens_price,
      slip_verified, slip_verify_message, slip_verify_amount, slip_verify_ref, slip_verified_at,
      line_message_status, line_message_error, line_message_attempted_at,
      line_message_sent_at, line_message_attempt_count, line_message_http_status,
      line_message_error_detail, line_message_request_id,
      user_id, line_sub,
      concert_sessions:session_id (
        start_at, note,
        concerts:concert_id ( title, venue_name )
      ),
      phones:phone_id ( model_name )
    `)
    .order("created_at", { ascending: false })
    // ไม่เอา "เครื่องที่ลูกค้ากันไว้แต่ยังไม่ได้โอน/แนบสลิป" มาปนในคิวแอดมิน
    // (แถวพวกนี้มี pending_expires_at และยังไม่มี slip_url — เป็นแค่การกันของชั่วคราว)
    .not("slip_url", "is", null);

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

  const bookings = data ?? [];
  const userIds = Array.from(
    new Set(bookings.map((b) => b.user_id).filter((id): id is string => Boolean(id)))
  );

  let bannedMap: Record<string, boolean> = {};
  if (userIds.length > 0) {
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, is_banned")
      .in("id", userIds);
    bannedMap = Object.fromEntries((profiles ?? []).map((p) => [p.id, Boolean(p.is_banned)]));
  }

  const bookingsWithBanStatus = bookings.map((b) => ({
    ...b,
    is_banned: b.user_id ? bannedMap[b.user_id] ?? false : false,
  }));

  return NextResponse.json(
    { bookings: bookingsWithBanStatus },
    { headers: { "Cache-Control": "no-store" } }
  );
}
