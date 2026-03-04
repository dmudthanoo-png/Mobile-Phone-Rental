import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !serviceKey) {
      return NextResponse.json(
        {
          error: "missing env",
          missing: {
            NEXT_PUBLIC_SUPABASE_URL: !url,
            SUPABASE_SERVICE_ROLE_KEY: !serviceKey,
          },
        },
        { status: 500 }
      );
    }

    const { id: sessionId } = await params;
    if (!sessionId) return NextResponse.json({ error: "missing session id" }, { status: 400 });

    const supabaseAdmin = createClient(url, serviceKey);

    // 1) โหลด inventory + ข้อมูล phone
    // หมายเหตุ: select relation "phones(...)" จะใช้ได้เมื่อ FK ถูกสร้างไว้แล้ว (phone_id -> phones.id)
    const invRes = await supabaseAdmin
      .from("session_phone_inventory")
      .select("qty, phone_id, phones (id, model_name, image_url, price, active)")
      .eq("session_id", sessionId);

    if (invRes.error) return NextResponse.json({ error: invRes.error.message }, { status: 500 });

    const invRows = (invRes.data ?? []) as any[];

    // ถ้า session ยังไม่ set inventory
    if (invRows.length === 0) {
      return NextResponse.json({ phones: [] }, { status: 200, headers: { "Cache-Control": "no-store" } });
    }

    // 2) โหลด bookings ที่กินสต๊อกของ session นี้ (confirmed + pending active)
    // pending active = (pending_expires_at is null) OR (pending_expires_at > now)
    const nowIso = new Date().toISOString();

    const bkRes = await supabaseAdmin
      .from("bookings")
      .select("phone_id")
      .eq("session_id", sessionId)
      .or(
        `status.eq.confirmed,status.eq.pending.and(pending_expires_at.is.null),status.eq.pending.and(pending_expires_at.gt.${nowIso})`
      );

    if (bkRes.error) return NextResponse.json({ error: bkRes.error.message }, { status: 500 });

    const bookedRows = (bkRes.data ?? []) as { phone_id: string | null }[];

    // 3) count booked per phone_id
    const bookedCount: Record<string, number> = {};
    for (const r of bookedRows) {
      const pid = r.phone_id ?? "";
      if (!pid) continue;
      bookedCount[pid] = (bookedCount[pid] || 0) + 1;
    }

    // 4) build response
    const phones = invRows
      .filter((r) => r.phones && r.phones.active !== false) // show only active phones
      .map((r) => {
        const phone = r.phones;
        const qty = Number(r.qty ?? 0);
        const booked = Number(bookedCount[String(r.phone_id)] ?? 0);
        const remaining = Math.max(0, qty - booked);

        return {
          phone_id: String(phone.id),
          model_name: String(phone.model_name ?? ""),
          image_url: phone.image_url ?? null,
          price: Number(phone.price ?? 0),
          remaining,
        };
      })
      // เรียงให้รุ่นที่เหลือเยอะขึ้นก่อน (ปรับได้)
      .sort((a, b) => b.remaining - a.remaining);

    return NextResponse.json(
      { phones },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
 } catch (err: any) {
    console.error("GET /api/sessions/[id]/phones error:", err);
    return NextResponse.json({ error: err?.message || "server_error" }, { status: 500 });
  }
}