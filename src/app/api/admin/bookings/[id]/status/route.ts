import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/adminAuth";
import {
  sendAndRecordBookingApprovalLineMessage,
  type BookingLineNotificationResult,
  type BookingLineNotificationRow,
} from "@/lib/lineBookingNotification";
import { syncBookingToSheet } from "@/lib/sheetsSync";

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// PATCH /api/admin/bookings/[id]/status — body: { status: "confirmed" | "rejected" }
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id?: string }> }
) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;

  if (!id) {
    return NextResponse.json({ error: "missing id param" }, { status: 400 });
  }

  if (id === "undefined" || !uuidRe.test(id)) {
    return NextResponse.json({ error: `invalid booking id: ${id}` }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const rawStatus = (body as { status?: string } | null)?.status;

  if (!["confirmed", "rejected"].includes(rawStatus ?? "")) {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }
  const status = rawStatus as "confirmed" | "rejected";

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    return NextResponse.json(
      { error: "missing env (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" },
      { status: 500 }
    );
  }

  const supabase = createClient(url, serviceKey);

  // rejected → คืน stock ด้วย RPC, confirmed → update ตรงได้เลย
  if (status === "rejected") {
    const { error } = await supabase.rpc("reject_booking_and_restore", {
      p_booking_id: id,
    });
    if (error) {
      if (error.message.includes("NOT_PENDING")) {
        return NextResponse.json(
          { error: "booking ไม่ได้อยู่ในสถานะ pending" },
          { status: 400 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  } else {
    // เปลี่ยนได้เฉพาะรายการที่กำลังรอตรวจสอบ เพื่อกันการกดซ้ำแล้วส่ง LINE ซ้ำ
    const { data: updatedBooking, error } = await supabase
      .from("bookings")
      .update({ status })
      .eq("id", id)
      .in("status", ["pending", "waiting_review"])
      .select("id")
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!updatedBooking) {
      return NextResponse.json(
        { error: "booking ไม่ได้อยู่ในสถานะรอตรวจสอบ" },
        { status: 409 }
      );
    }
  }

  // ดึงข้อมูลล่าสุดสำหรับ sync Google Sheet และแจ้งผู้จองผ่าน LINE
  const { data: bookingRowRaw, error: bookingRowError } = await supabase
    .from("bookings")
    .select(
      "user_id, line_sub, ref_number, renter_name, renter_phone, qty, lens_qty, total_amount, created_at, line_message_attempt_count, " +
      "phones ( model_name ), lenses ( name ), " +
      "concert_sessions ( start_at, note, concerts ( title ) )"
    )
    .eq("id", id)
    .maybeSingle();

  if (bookingRowError) {
    console.error("booking details lookup failed:", bookingRowError.message);
  }

  type BookingSyncRow = BookingLineNotificationRow & {
    renter_name: string;
    renter_phone: string;
    created_at: string | null;
  };
  const bookingRow = bookingRowRaw as unknown as BookingSyncRow | null;

  if (bookingRow) {
    const session = bookingRow.concert_sessions;
    const phone = bookingRow.phones;
    const lens = bookingRow.lenses;

    await syncBookingToSheet({
      event: "status_changed",
      booking_id: id,
      ref_number: bookingRow.ref_number ?? null,
      status,
      renter_name: bookingRow.renter_name,
      renter_phone: bookingRow.renter_phone,
      concert_title: session?.concerts?.title ?? null,
      session_label: session?.start_at
        ? `${session.note ?? "รอบ"} • ${new Date(session.start_at).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })}`
        : null,
      phone_model: phone?.model_name ?? null,
      qty: bookingRow.qty ?? null,
      lens_name: lens?.name ?? null,
      lens_qty: bookingRow.lens_qty ?? null,
      total_amount: bookingRow.total_amount ?? null,
      created_at: bookingRow.created_at ?? null,
    });
  }

  let lineDelivery: BookingLineNotificationResult | undefined;
  if (status === "confirmed") {
    if (bookingRow) {
      lineDelivery = await sendAndRecordBookingApprovalLineMessage(supabase, id, bookingRow);
    } else {
      console.error("LINE approval notification skipped: booking details could not be loaded");
    }
  }

  if (status === "confirmed") {
    const notification = lineDelivery?.result ?? {
      sent: false as const,
      reason: "delivery_failed" as const,
    };
    const recorded = Boolean(lineDelivery && !lineDelivery.recordError);

    return NextResponse.json({
      ok: true,
      notification: notification.sent
        ? { sent: true, recorded }
        : {
            sent: false,
            reason: notification.reason,
            httpStatus: notification.httpStatus ?? null,
            errorDetail: notification.errorDetail ?? null,
            requestId: notification.requestId ?? null,
            recorded,
          },
    });
  }

  return NextResponse.json({ ok: true });
}
