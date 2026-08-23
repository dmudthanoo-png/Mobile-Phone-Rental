import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/admin/users — แอดมินดูรายชื่อผู้ใช้ทั้งหมด (สำหรับแบน/ปลดแบน)
export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabaseAdmin = createClient(url, serviceKey);

  const { data: profiles, error } = await supabaseAdmin
    .from("profiles")
    .select("id, line_sub, name, picture, is_banned, banned_at, ban_reason")
    .order("is_banned", { ascending: false })
    .order("name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const userIds = (profiles ?? []).map((p) => p.id);

  let bookingStats: Record<string, { count: number; totalSpent: number }> = {};
  if (userIds.length > 0) {
    const { data: bookings } = await supabaseAdmin
      .from("bookings")
      .select("user_id, total_amount, status")
      .in("user_id", userIds);

    bookingStats = (bookings ?? []).reduce((acc, b) => {
      if (!b.user_id) return acc;
      const entry = acc[b.user_id] ?? { count: 0, totalSpent: 0 };
      entry.count += 1;
      if (b.status === "confirmed") entry.totalSpent += Number(b.total_amount ?? 0);
      acc[b.user_id] = entry;
      return acc;
    }, {} as Record<string, { count: number; totalSpent: number }>);
  }

  const users = (profiles ?? []).map((p) => ({
    ...p,
    booking_count: bookingStats[p.id]?.count ?? 0,
    total_spent: bookingStats[p.id]?.totalSpent ?? 0,
  }));

  return NextResponse.json(
    { users },
    { headers: { "Cache-Control": "no-store" } }
  );
}
