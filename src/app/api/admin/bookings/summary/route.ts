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
  const supabase = createClient(url, serviceKey);

  const total = await supabase.from("bookings").select("id", { count: "exact", head: true });

  const pending = await supabase
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  const confirmed = await supabase
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("status", "confirmed");

  const rejected = await supabase
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("status", "rejected");

  // ✅ revenue รวมเฉพาะ confirmed
  const confirmedAmounts = await supabase
    .from("bookings")
    .select("total_amount")
    .eq("status", "confirmed");

  // ถ้ามี error อันไหน ให้แจ้ง
  const err =
    total.error ||
    pending.error ||
    confirmed.error ||
    rejected.error ||
    confirmedAmounts.error;

  if (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  const revenue =
    (confirmedAmounts.data ?? []).reduce(
      (acc: number, row: any) => acc + (Number(row.total_amount) || 0),
      0
    );

  return NextResponse.json(
    {
      total: total.count ?? 0,
      pending: pending.count ?? 0,
      confirmed: confirmed.count ?? 0,
      rejected: rejected.count ?? 0,
      revenue, // ✅ เพิ่มตัวนี้
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}