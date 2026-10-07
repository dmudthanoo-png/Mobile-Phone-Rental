import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/adminAuth";
import { logServerError } from "@/lib/apiLog";
import { retryRead } from "@/lib/supabaseRetry";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(url, serviceKey);

  // ทุกตัวเลขสรุปต้องไม่นับ "เครื่องที่ลูกค้ากันไว้แต่ยังไม่ได้โอน" (slip_url ว่าง = แค่กันของชั่วคราว)
  // ทุกอันเป็นการนับอย่างเดียว → ลองใหม่ได้ถ้าเน็ต/เกตเวย์สะดุดชั่วคราว
  // (endpoint นี้คือตัวที่ 500 จริงตอน 20:06 วันที่ 12 ก.ย. 2569 เพราะไม่เคยมี retry)
  const total = await retryRead("/api/admin/bookings/summary (total)", () =>
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .not("slip_url", "is", null)
  );

  const pending = await retryRead("/api/admin/bookings/summary (pending)", () =>
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .not("slip_url", "is", null)
  );

  const confirmed = await retryRead("/api/admin/bookings/summary (confirmed)", () =>
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("status", "confirmed")
  );

  const rejected = await retryRead("/api/admin/bookings/summary (rejected)", () =>
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("status", "rejected")
  );

  const cancelled = await retryRead("/api/admin/bookings/summary (cancelled)", () =>
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("status", "cancelled")
  );
  // Read all money in one database snapshot when cancellation is in use, avoiding
  // double-counting during refunds. Old installations with no cancellations still
  // use the existing query below, without requiring the new RPC before migration.
  type MoneySummary = { revenue: number; deposit_received: number; refund_pending: number; refunded_amount: number };
  let moneySummary: MoneySummary | null = null;
  let refundError: { message: string } | null = null;
  if ((cancelled.count ?? 0) > 0) {
    const result = await retryRead("/api/admin/bookings/summary (money snapshot)", () =>
      supabase.rpc("admin_cancellation_money_summary"));
    refundError = result.error;
    if (!refundError) {
      const fields = ["revenue", "deposit_received", "refund_pending", "refunded_amount"];
      if (!result.data || !fields.every(key => typeof result.data[key] === "number" && Number.isFinite(result.data[key]))) {
        refundError = { message: "อ่านยอดคืนมัดจำไม่สำเร็จ กรุณาลองใหม่" };
      } else moneySummary = result.data as MoneySummary;
    }
  }

  // ✅ revenue รวมเฉพาะ confirmed — เป็นมูลค่าการจองรวม (คาดการณ์) ไม่ใช่เงินที่ได้รับจริงทั้งหมด
  // เพราะ total_amount รวมส่วนที่ลูกค้าจ่ายวันรับเครื่องด้วย ซึ่งไม่เคยผ่านแอปนี้เลย
  // ยอดที่ยืนยันรับจริงผ่านแอป (โอนมัดจำ+ตรวจสลิปแล้ว) คือ deposit_received ต่างหาก
  // ⚠️ Supabase คืนสูงสุด 1,000 แถวต่อครั้ง ถ้าดึงรวดเดียวแล้วบวกใน JS ยอดจะขาดหายเมื่อ
  // การจองเกิน 1,000 รายการ (จำนวนรายการถูกเพราะใช้ count แต่ยอดเงินจะน้อยกว่าจริง)
  // จึงต้องไล่ดึงเป็นหน้าๆ จนครบ
  const PAGE = 1000;
  const amountRows: { total_amount: number | string | null; deposit_amount: number | string | null }[] = [];
  let amountsError: { message: string } | null = null;
  for (let from = 0; !moneySummary && !refundError; from += PAGE) {
    const pageFrom = from;
    const page = await retryRead(`/api/admin/bookings/summary (amounts ${pageFrom})`, () =>
      supabase
        .from("bookings")
        .select("total_amount, deposit_amount")
        .eq("status", "confirmed")
        .range(pageFrom, pageFrom + PAGE - 1)
    );
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
    cancelled.error ||
    refundError ||
    confirmedAmounts.error;

  if (err) {
    logServerError("/api/admin/bookings/summary", err.message);
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
      cancelled: cancelled.count ?? 0,
      revenue: moneySummary?.revenue ?? revenue, // รวมเฉพาะรายการ confirmed
      // Preserve gross deposit history; refund_pending is part of it, not extra revenue.
      deposit_received: moneySummary?.deposit_received ?? depositReceived,
      refund_pending: moneySummary?.refund_pending ?? 0,
      refunded_amount: moneySummary?.refunded_amount ?? 0,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
