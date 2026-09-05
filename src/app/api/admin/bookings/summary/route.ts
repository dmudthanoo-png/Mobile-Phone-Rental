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

  // ทุกตัวเลขสรุปต้องไม่นับ "เครื่องที่ลูกค้ากันไว้แต่ยังไม่ได้โอน" (slip_url ว่าง = แค่กันของชั่วคราว)
  const total = await supabase
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .not("slip_url", "is", null);

  const pending = await supabase
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .not("slip_url", "is", null);

  const confirmed = await supabase
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("status", "confirmed");

  const rejected = await supabase
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("status", "rejected");

  // ✅ revenue รวมเฉพาะ confirmed — เป็นมูลค่าการจองรวม (คาดการณ์) ไม่ใช่เงินที่ได้รับจริงทั้งหมด
  // เพราะ total_amount รวมส่วนที่ลูกค้าจ่ายวันรับเครื่องด้วย ซึ่งไม่เคยผ่านแอปนี้เลย
  // ยอดที่ยืนยันรับจริงผ่านแอป (โอนมัดจำ+ตรวจสลิปแล้ว) คือ deposit_received ต่างหาก
  // ⚠️ Supabase คืนสูงสุด 1,000 แถวต่อครั้ง ถ้าดึงรวดเดียวแล้วบวกใน JS ยอดจะขาดหายเมื่อ
  // การจองเกิน 1,000 รายการ (จำนวนรายการถูกเพราะใช้ count แต่ยอดเงินจะน้อยกว่าจริง)
  // จึงต้องไล่ดึงเป็นหน้าๆ จนครบ
  const PAGE = 1000;
  const amountRows: { total_amount: number | string | null; deposit_amount: number | string | null }[] = [];
  let amountsError: { message: string } | null = null;
  for (let from = 0; ; from += PAGE) {
    const page = await supabase
      .from("bookings")
      .select("total_amount, deposit_amount")
      .eq("status", "confirmed")
      .range(from, from + PAGE - 1);
    if (page.error) { amountsError = page.error; break; }
    const rows = page.data ?? [];
    amountRows.push(...rows);
    if (rows.length < PAGE) break;
  }
  const confirmedAmounts = { data: amountRows, error: amountsError };

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
      (acc: number, row: { total_amount: number | string | null }) =>
        acc + (Number(row.total_amount) || 0),
      0
    );

  // deposit_amount เป็น null สำหรับ booking เก่าที่จองก่อนมีคอลัมน์นี้ (ไม่ได้ backfill ไว้) — นับเฉพาะที่มีค่าจริง
  const depositReceived =
    (confirmedAmounts.data ?? []).reduce(
      (acc: number, row: { deposit_amount: number | string | null }) =>
        acc + (Number(row.deposit_amount) || 0),
      0
    );

  return NextResponse.json(
    {
      total: total.count ?? 0,
      pending: pending.count ?? 0,
      confirmed: confirmed.count ?? 0,
      rejected: rejected.count ?? 0,
      revenue, // ✅ มูลค่าการจองรวม (คาดการณ์) — รวมส่วนที่จ่ายวันรับเครื่องด้วย
      deposit_received: depositReceived, // ✅ ยอดมัดจำที่ยืนยันรับจริงผ่านแอป
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}