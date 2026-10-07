import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/adminAuth";
import { logServerError } from "@/lib/apiLog";
import { syncBookingToSheet } from "@/lib/sheetsSync";
import type { CancellationSummary } from "@/lib/bookingCancellation";

export const REFUND_PROOF_BUCKET = "refund-proofs";
export const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const cancellationFields = "booking_id, refund_amount, refund_status, cancelled_at, refunded_at";
export type CancellationRecord = CancellationSummary & {
  reason: string; cancelled_by_username: string; processing_by: string | null;
  processing_by_username: string | null; processing_at: string | null;
  refunded_by_username: string | null; refund_reference: string | null; refund_proof_path: string | null;
};

export async function cancellationContext(req: NextRequest, params: Promise<{ id?: string }>) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const { id } = await params;
  if (!id || !uuidRe.test(id)) return { error: NextResponse.json({ error: "invalid booking id" }, { status: 400 }) };
  // Extra CSRF defense for these irreversible, cookie-authenticated actions.
  const origin = req.headers.get("origin");
  if (req.method !== "GET" && (req.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== new URL(req.url).origin))) {
    return { error: NextResponse.json({ error: "forbidden origin" }, { status: 403 }) };
  }
  const adminId = String(admin.payload.admin_id ?? "");
  if (!uuidRe.test(adminId)) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { error: NextResponse.json({ error: "missing env" }, { status: 503 }) };
  return { id, adminId, supabase: createClient(url, key) };
}

export function cancellationDatabaseError(error: { message: string; code?: string }) {
  logServerError("booking cancellation", error.message);
  const missing = ["42P01", "42883", "PGRST202", "PGRST205"].includes(error.code ?? "");
  return NextResponse.json({ error: missing
    ? "ยังไม่ได้ติดตั้งระบบคืนมัดจำ กรุณารัน scripts/add_booking_cancellation.sql ก่อน"
    : "บันทึกไม่สำเร็จหรือยังยืนยันผลไม่ได้ กรุณาโหลดรายการล่าสุดก่อนทำซ้ำ" }, { status: 503 });
}

const errors: Record<string, string> = {
  UNAUTHORIZED: "ไม่มีสิทธิ์ดำเนินการ", NOT_FOUND: "ไม่พบรายการนี้",
  INVALID_REASON: "กรุณาระบุเหตุผล 3–500 ตัวอักษร", NOT_CONFIRMED: "ยกเลิกได้เฉพาะรายการที่ยืนยันแล้ว",
  ALREADY_FULFILLED: "รายการนี้มีการส่งมอบ/คืนเครื่อง/ส่งไฟล์แล้ว ไม่สามารถยกเลิกผ่านขั้นตอนนี้",
  DEPOSIT_NOT_100: "มัดจำของรายการนี้ไม่ใช่ 100 บาท กรุณาตรวจสอบ — ระบบนี้คืนเฉพาะมัดจำ 100 บาท",
  DEPOSIT_UNKNOWN: "ยังยืนยันยอดมัดจำ 100 บาทของรายการเก่านี้ไม่ได้ กรุณาตรวจสอบหลักฐานก่อน",
  DEPOSIT_MISMATCH: "ยอดมัดจำกับผลตรวจสลิปไม่ตรงกัน กรุณาตรวจสอบก่อนยกเลิก",
  NOT_CANCELLED: "รายการนี้ยังไม่ได้ยกเลิก", ALREADY_REFUNDED: "บันทึกคืนเงินแล้ว ห้ามโอนซ้ำ",
  CLAIMED_BY_OTHER: "แอดมินคนอื่นกำลังดำเนินการคืนเงิน ห้ามโอนซ้ำ",
  CLAIM_REQUIRED: "ต้องรับงานคืนเงินด้วยบัญชีนี้ก่อน ห้ามโอนจนกว่าจะรับงานสำเร็จ",
  INVALID_ACTION: "คำสั่งไม่ถูกต้อง", INVALID_REFERENCE: "กรุณาระบุเลขอ้างอิงโอนคืน 3–120 ตัวอักษร",
  INVALID_PROOF: "ไม่พบหลักฐานคืนเงินที่ถูกต้อง", REFERENCE_USED: "เลขอ้างอิงนี้ถูกบันทึกคืนเงินให้รายการอื่นแล้ว",
};

export function cancellationRpcError(data: unknown) {
  const r = data as { ok?: boolean; error?: string } | null;
  if (r?.error) return NextResponse.json({ error: errors[r.error] ?? "ดำเนินการไม่สำเร็จ" }, {
    status: r.error === "NOT_FOUND" ? 404 : r.error === "UNAUTHORIZED" ? 403 : 409,
  });
  if (r?.ok !== true) return cancellationDatabaseError({ message: "Unexpected cancellation RPC result" });
  return null;
}

// Only query the new table for cancelled bookings, so an additive rollout cannot
// break normal booking/history pages before the migration has been installed.
export async function readCancellationSummaries(supabase: SupabaseClient, ids: string[]) {
  const result = new Map<string, CancellationSummary>();
  if (!ids.length) return result;
  const { data, error } = await supabase.from("booking_cancellations").select(cancellationFields).in("booking_id", ids);
  if (error) { logServerError("cancellation history", error.message); return result; }
  for (const row of (data ?? []) as CancellationSummary[]) result.set(row.booking_id, row);
  return result;
}

// Best-effort external copy only. Database/audit are committed first. NO LINE.
export async function syncCancelledBooking(supabase: SupabaseClient, id: string) {
  if (!process.env.SHEETS_WEBHOOK_URL) return;
  const { data, error } = await supabase.from("bookings").select(
    "ref_number,status,renter_name,renter_phone,qty,lens_qty,total_amount,created_at," +
    "phones:phone_id(model_name),lenses:lens_id(name),concert_sessions:session_id(start_at,note,concerts:concert_id(title))"
  ).eq("id", id).maybeSingle();
  if (error || !data) { logServerError("cancellation sheet sync", error?.message ?? "booking not found"); return; }
  const row = data as unknown as {
    ref_number: string; status: string; renter_name: string; renter_phone: string; qty: number;
    lens_qty: number; total_amount: number; created_at: string; phones: { model_name: string } | null;
    lenses: { name: string } | null;
    concert_sessions: { start_at: string; note: string | null; concerts: { title: string } | null } | null;
  };
  const { data: cancellation } = await supabase.from("booking_cancellations").select(cancellationFields).eq("booking_id", id).maybeSingle();
  await syncBookingToSheet({
    event: "status_changed", booking_id: id, ref_number: row.ref_number, status: row.status,
    renter_name: row.renter_name, renter_phone: row.renter_phone, qty: row.qty, lens_qty: row.lens_qty,
    phone_model: row.phones?.model_name, lens_name: row.lenses?.name,
    concert_title: row.concert_sessions?.concerts?.title,
    session_label: row.concert_sessions?.start_at
      ? new Date(row.concert_sessions.start_at).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" }) : null,
    total_amount: row.total_amount, created_at: row.created_at,
    refund_amount: cancellation?.refund_amount, refund_status: cancellation?.refund_status,
  });
}
