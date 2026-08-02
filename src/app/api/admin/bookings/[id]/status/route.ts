import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/adminAuth";
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
    const { error } = await supabase
      .from("bookings")
      .update({ status })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // sync สถานะล่าสุดไป Google Sheet แบบ best-effort (ไม่บล็อก response)
  const { data: bookingRowRaw } = await supabase
    .from("bookings")
    .select(
      "ref_number, renter_name, renter_phone, qty, lens_qty, total_amount, created_at, " +
      "phones ( model_name ), lenses ( name ), " +
      "concert_sessions ( start_at, note, concerts ( title ) )"
    )
    .eq("id", id)
    .maybeSingle();

  type BookingSyncRow = {
    ref_number: string | null;
    renter_name: string;
    renter_phone: string;
    qty: number | null;
    lens_qty: number | null;
    total_amount: number | null;
    created_at: string | null;
    phones: { model_name: string } | null;
    lenses: { name: string } | null;
    concert_sessions: { start_at: string | null; note: string | null; concerts: { title: string } | null } | null;
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

  return NextResponse.json({ ok: true });
}