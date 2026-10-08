import { after, NextRequest, NextResponse } from "next/server";
import { isRefundAmount, resolveCancellationDeposit } from "@/lib/bookingCancellation";
import {
  cancellationContext, cancellationDatabaseError, cancellationRpcError, syncCancelledBooking,
} from "@/lib/bookingCancellationServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id?: string }> };

export async function GET(req: NextRequest, ctx: Context) {
  const auth = await cancellationContext(req, ctx.params);
  if (auth.error) return auth.error;
  const { supabase, id, adminId } = auth;
  const { data: booking, error } = await supabase.from("bookings").select(
    "id,ref_number,renter_name,status,deposit_amount,slip_verified,slip_verify_amount,delivered_at,returned_at,files_sent_at"
  ).eq("id", id).maybeSingle();
  if (error) return cancellationDatabaseError(error);
  if (!booking) return NextResponse.json({ error: "ไม่พบรายการจอง" }, { status: 404 });
  const { data: cancellation, error: cancelError } = await supabase.from("booking_cancellations").select("*").eq("booking_id", id).maybeSingle();
  if (cancelError) return cancellationDatabaseError(cancelError);
  const deposit = resolveCancellationDeposit(booking);
  let blockedReason: string | null = null;
  if (booking.status !== "confirmed") blockedReason = "ยกเลิกได้เฉพาะรายการที่ยืนยันแล้ว";
  else if (booking.delivered_at || booking.returned_at || booking.files_sent_at) blockedReason = "รายการนี้มีการส่งมอบ/คืนเครื่อง/ส่งไฟล์แล้ว";
  else if (deposit.error === "DEPOSIT_MISMATCH") blockedReason = "ยอดมัดจำกับผลตรวจสลิปไม่ตรงกัน กรุณาตรวจสอบก่อนยกเลิก";
  else if (deposit.error) blockedReason = "ยังยืนยันยอดมัดจำที่รับจริงไม่ได้ หรือยอดไม่ถูกต้อง กรุณาตรวจสอบหลักฐานก่อน";
  return NextResponse.json({
    booking, cancellation, can_cancel: blockedReason === null, blocked_reason: blockedReason,
    refund_amount: cancellation?.refund_amount ?? deposit.amount,
    can_manage_refund: cancellation?.refund_status === "processing" && cancellation.processing_by === adminId,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest, ctx: Context) {
  const auth = await cancellationContext(req, ctx.params);
  if (auth.error) return auth.error;
  const body = await req.json().catch(() => null);
  if (typeof body?.reason !== "string" || body.reason.trim().length < 3 || body.reason.trim().length > 500
    || body.confirmed_deposit !== true || !isRefundAmount(body.expected_refund_amount)) {
    return NextResponse.json({ error: "กรุณาระบุเหตุผล 3–500 ตัวอักษร โหลดข้อมูลล่าสุดและยืนยันยอดมัดจำที่รับจริง" }, { status: 400 });
  }
  const { supabase, id, adminId } = auth;
  const { data, error } = await supabase.rpc("admin_cancel_booking", {
    p_booking_id: id, p_admin_id: adminId, p_reason: body.reason.trim(),
    // An acknowledgement only: SQL derives the actual refund from the locked
    // booking and rejects a stale/tampered preview, never trusts this as money.
    p_expected_refund_amount: body.expected_refund_amount,
  });
  if (error) return cancellationDatabaseError(error);
  const failed = cancellationRpcError(data);
  if (failed) return failed;
  // SQL writes cancellation + audit atomically. No notification or LINE call.
  after(() => syncCancelledBooking(supabase, id));
  return NextResponse.json({ ok: true, unchanged: data.unchanged === true });
}
