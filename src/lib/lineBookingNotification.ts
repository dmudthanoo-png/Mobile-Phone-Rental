import type { SupabaseClient } from "@supabase/supabase-js";
import {
  sendBookingApprovedLineMessage,
  type LinePushResult,
} from "@/lib/lineMessaging";

export type BookingLineNotificationRow = {
  user_id: string | null;
  line_sub: string | null;
  ref_number: string | null;
  renter_name: string | null;
  qty: number | null;
  lens_qty: number | null;
  total_amount: number | null;
  deposit_amount?: number | null;
  line_message_attempt_count: number | null;
  phones: { model_name: string; deposit: number | null } | null;
  lenses: { name: string } | null;
  concert_sessions: {
    start_at: string | null;
    note: string | null;
    concerts: { title: string } | null;
  } | null;
};

export type StoredLineMessageStatus = "sent" | "failed" | "quota_exceeded";

export type BookingLineNotificationResult = {
  result: LinePushResult;
  status: StoredLineMessageStatus;
  attemptedAt: string;
  attemptCount: number;
  recordError?: string;
};

function buildSessionLabel(booking: BookingLineNotificationRow) {
  if (!booking.concert_sessions?.start_at) return null;

  return `${booking.concert_sessions.note ?? "รอบ"} • ${new Date(
    booking.concert_sessions.start_at
  ).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })}`;
}

async function resolveLineUserId(
  supabase: SupabaseClient,
  booking: BookingLineNotificationRow
) {
  let lineUserId = booking.line_sub ?? null;

  // การจองบางเวอร์ชันอาจเก็บเพียง user_id จึงหา LINE ID จาก profile เพิ่มเติม
  if (!lineUserId && booking.user_id) {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("line_sub")
      .eq("id", booking.user_id)
      .maybeSingle();

    if (profileError) {
      console.error("LINE profile lookup failed:", profileError.message);
    } else {
      lineUserId = profile?.line_sub ?? null;
    }
  }

  return lineUserId;
}

/**
 * ส่งข้อความอนุมัติและบันทึกผลไว้กับ booking เดียวกัน เพื่อให้หน้าแอดมิน
 * แสดงผลได้หลังรีเฟรช และใช้เป็นเงื่อนไขของปุ่มส่งซ้ำได้
 */
export async function sendAndRecordBookingApprovalLineMessage(
  supabase: SupabaseClient,
  bookingId: string,
  booking: BookingLineNotificationRow
): Promise<BookingLineNotificationResult> {
  const attemptedAt = new Date().toISOString();
  const lineUserId = await resolveLineUserId(supabase, booking);
  const result = await sendBookingApprovedLineMessage({
    lineUserId,
    refNumber: booking.ref_number,
    renterName: booking.renter_name,
    concertTitle: booking.concert_sessions?.concerts?.title ?? null,
    sessionLabel: buildSessionLabel(booking),
    phoneModel: booking.phones?.model_name ?? null,
    qty: booking.qty,
    lensName: booking.lenses?.name ?? null,
    lensQty: booking.lens_qty,
    totalAmount: booking.total_amount,
    // ใช้ยอดมัดจำที่บันทึกไว้ตอนจองเป็นหลัก — ถ้าคิดสดจากราคาปัจจุบัน พอแอดมินแก้ราคามัดจำ
    // ทีหลัง ข้อความที่ส่งซ้ำให้ลูกค้าเก่าจะโชว์ยอดไม่ตรงกับที่โอนมาจริง
    // (การจองเก่าที่ยังไม่มีค่านี้ ค่อย fallback ไปคิดสดแบบเดิม)
    depositPaid: booking.deposit_amount != null
      ? Number(booking.deposit_amount)
      : Number(booking.phones?.deposit ?? 0) * Number(booking.qty ?? 1),
  });

  const status: StoredLineMessageStatus = result.sent
    ? "sent"
    : result.reason === "quota_exceeded"
      ? "quota_exceeded"
      : "failed";
  const priorAttempts = Number(booking.line_message_attempt_count ?? 0);
  const attemptCount = (Number.isFinite(priorAttempts) ? Math.max(0, priorAttempts) : 0) + 1;

  const { error: recordError } = await supabase
    .from("bookings")
    .update({
      line_message_status: status,
      line_message_error: result.sent ? null : result.reason,
      line_message_http_status: result.sent ? null : result.httpStatus ?? null,
      line_message_error_detail: result.sent ? null : result.errorDetail ?? null,
      line_message_request_id: result.sent ? null : result.requestId ?? null,
      line_message_attempted_at: attemptedAt,
      line_message_sent_at: result.sent ? attemptedAt : null,
      line_message_attempt_count: attemptCount,
    })
    .eq("id", bookingId);

  if (recordError) {
    console.error("LINE delivery status could not be recorded:", recordError.message);
  }

  return {
    result,
    status,
    attemptedAt,
    attemptCount,
    ...(recordError ? { recordError: recordError.message } : {}),
  };
}
