import { after, NextRequest, NextResponse } from "next/server";
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
  const amount = booking.deposit_amount ?? (booking.slip_verified === true ? booking.slip_verify_amount : null);
  let blockedReason: string | null = null;
  if (booking.status !== "confirmed") blockedReason = "ยกเลิกได้เฉพาะรายการที่ยืนยันแล้ว";
  else if (booking.delivered_at || booking.returned_at || booking.files_sent_at) blockedReason = "รายการนี้มีการส่งมอบ/คืนเครื่อง/ส่งไฟล์แล้ว";
  else if (amount == null || Number(amount) !== 100) blockedReason = "ยังยืนยันมัดจำ 100 บาทไม่ได้ หรือยอดมัดจำไม่ใช่ 100 บาท กรุณาตรวจสอบหลักฐานก่อน";
  else if (booking.slip_verified === true && booking.slip_verify_amount != null && Number(booking.slip_verify_amount) !== 100) blockedReason = "ยอดมัดจำกับผลตรวจสลิปไม่ตรงกัน";
  return NextResponse.json({
    booking, cancellation, can_cancel: blockedReason === null, blocked_reason: blockedReason,
    can_manage_refund: cancellation?.refund_status === "processing" && cancellation.processing_by === adminId,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest, ctx: Context) {
  const auth = await cancellationContext(req, ctx.params);
  if (auth.error) return auth.error;
  const body = await req.json().catch(() => null);
  if (typeof body?.reason !== "string" || body.reason.trim().length < 3 || body.reason.trim().length > 500 || body.confirmed_deposit !== true) {
    return NextResponse.json({ error: "กรุณาระบุเหตุผล 3–500 ตัวอักษร และยืนยันตรวจมัดจำ 100 บาทแล้ว" }, { status: 400 });
  }
  const { supabase, id, adminId } = auth;
  const { data, error } = await supabase.rpc("admin_cancel_booking", {
    p_booking_id: id, p_admin_id: adminId, p_reason: body.reason.trim(),
  });
  if (error) return cancellationDatabaseError(error);
  const failed = cancellationRpcError(data);
  if (failed) return failed;
  // SQL writes cancellation + audit atomically. No notification or LINE call.
  after(() => syncCancelledBooking(supabase, id));
  return NextResponse.json({ ok: true, unchanged: data.unchanged === true });
}
