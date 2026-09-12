import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/adminAuth";
import { logAdminAction } from "@/lib/adminAudit";
import { logServerError } from "@/lib/apiLog";
import {
  sendAndRecordBookingApprovalLineMessage,
  type BookingLineNotificationRow,
} from "@/lib/lineBookingNotification";

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// POST /api/admin/bookings/[id]/line-notification — ส่งซ้ำเมื่อส่งไม่สำเร็จ/โควต้าหมด หรือยังไม่มีประวัติเดิม
// body (ไม่บังคับ): { force: true } = ส่งซ้ำได้แม้เคยส่งสำเร็จแล้ว
//   ใช้ตอนแอดมินแก้เลนส์ของรายการที่ยืนยันไปแล้ว ทำให้ยอดเปลี่ยน จึงต้องแจ้งยอดใหม่ให้ลูกค้า
//   (ข้อความถูกสร้างใหม่จากข้อมูลล่าสุดทุกครั้ง จึงได้ยอดใหม่เสมอ)
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id?: string }> }
) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!id || id === "undefined" || !uuidRe.test(id)) {
    return NextResponse.json({ error: "invalid booking id" }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as { force?: unknown } | null;
  const force = body?.force === true;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    logServerError("/api/admin/bookings/[id]/line-notification", "missing env (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
    return NextResponse.json(
      { error: "missing env (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" },
      { status: 500 }
    );
  }

  const supabase = createClient(url, serviceKey);
  const { data: bookingRaw, error } = await supabase
    .from("bookings")
    .select(
      // ⚠️ ต้องดึง renter_name และ phones.deposit ด้วย ไม่งั้นข้อความที่ส่งซ้ำจะไม่มีชื่อผู้จอง
      // และรายการเก่าที่ยังไม่มี deposit_amount จะโชว์มัดจำเป็น 0 ทำให้ยอดคงเหลือผิด
      "status, line_message_status, user_id, line_sub, ref_number, renter_name, qty, lens_qty, total_amount, deposit_amount, " +
      "line_message_attempt_count, phones ( model_name, deposit ), lenses ( name ), " +
      "concert_sessions ( start_at, note, concerts ( title ) )"
    )
    .eq("id", id)
    .maybeSingle();

  if (error) { logServerError("/api/admin/bookings/[id]/line-notification", error); return NextResponse.json({ error: error.message }, { status: 500 }); }
  if (!bookingRaw) return NextResponse.json({ error: "ไม่พบรายการจอง" }, { status: 404 });

  type RetryBookingRow = BookingLineNotificationRow & {
    status: string | null;
    line_message_status: "sent" | "failed" | "quota_exceeded" | null;
  };
  const booking = bookingRaw as unknown as RetryBookingRow;

  if (booking.status !== "confirmed") {
    return NextResponse.json({ error: "ส่ง LINE ซ้ำได้หลังจากยืนยันการจองแล้วเท่านั้น" }, { status: 409 });
  }
  // force = แอดมินตั้งใจส่งยอดใหม่หลังแก้รายการ จึงข้ามการกันส่งซ้ำได้ (มี audit log กำกับไว้)
  if (
    !force &&
    booking.line_message_status !== null &&
    booking.line_message_status !== "failed" &&
    booking.line_message_status !== "quota_exceeded"
  ) {
    return NextResponse.json(
      { error: "ส่งซ้ำได้เฉพาะรายการที่ส่ง LINE ไม่สำเร็จ โควต้าหมด หรือยังไม่มีประวัติการส่ง" },
      { status: 409 }
    );
  }

  const delivery = await sendAndRecordBookingApprovalLineMessage(supabase, id, booking);
  const recorded = !delivery.recordError;

  // ส่งสำเร็จแล้วถือว่าลูกค้ารู้ยอดใหม่แล้ว จึงล้างธง "แก้แล้วยังไม่ได้แจ้ง"
  // (ธงนี้คือสิ่งที่ทำให้ปุ่มแจ้งยอดใหม่โผล่ในตาราง แม้ line_message_status จะเป็น sent อยู่)
  if (delivery.result.sent) {
    const { error: clearErr } = await supabase
      .from("bookings")
      .update({ details_changed_at: null })
      .eq("id", id);
    if (clearErr) console.error("clear details_changed_at failed:", id, clearErr.message);
  }

  await logAdminAction({
    username: String(admin.payload.username ?? ""),
    action: force ? "ส่งข้อความ LINE แจ้งยอดใหม่" : "ส่งข้อความ LINE แจ้งเตือนอีกครั้ง",
    detail: `รหัสการจอง ${id}${booking.ref_number ? ` (เลขอ้างอิง ${booking.ref_number})` : ""}`,
  });

  return NextResponse.json({
    ok: true,
    notification: delivery.result.sent
      ? { sent: true, recorded }
      : {
          sent: false,
          reason: delivery.result.reason,
          httpStatus: delivery.result.httpStatus ?? null,
          errorDetail: delivery.result.errorDetail ?? null,
          requestId: delivery.result.requestId ?? null,
          recorded,
        },
  });
}
