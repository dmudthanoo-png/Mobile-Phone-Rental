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
      return NextResponse.json({ error: "missing env" }, { status: 500 });
    }

    const { id: sessionId } = await params;
    if (!sessionId) return NextResponse.json({ error: "missing session id" }, { status: 400 });

    const supabase = createClient(url, serviceKey);

    // 1) ดึงมือถือทั้งหมดที่ active (เพิ่ม lens_addon_price)
    const { data: phoneRows, error: phoneErr } = await supabase
      .from("phones")
      .select("id, model_name, image_url, price, deposit, qty, lens_addon_price")
      .eq("active", true)
      .order("model_name");

    if (phoneErr) return NextResponse.json({ error: phoneErr.message }, { status: 500 });
    if (!phoneRows || phoneRows.length === 0) {
      return NextResponse.json({ phones: [] }, { headers: { "Cache-Control": "no-store" } });
    }

    // 2) นับ booking ที่กิน stock อยู่ (confirmed + pending)
    const { data: bookedRows, error: bkErr } = await supabase
      .from("bookings")
      .select("phone_id")
      .in("status", ["confirmed", "pending"]);

    if (bkErr) return NextResponse.json({ error: bkErr.message }, { status: 500 });

    // 3) นับจำนวนที่ถูกจองต่อรุ่น
    const bookedCount: Record<string, number> = {};
    for (const r of bookedRows ?? []) {
      if (!r.phone_id) continue;
      bookedCount[r.phone_id] = (bookedCount[r.phone_id] || 0) + 1;
    }

    // 4) คำนวณ remaining + ส่ง lens_addon_price กลับ
    const phones = phoneRows
      .map((p) => ({
        phone_id: String(p.id),
        model_name: String(p.model_name ?? ""),
        image_url: p.image_url ?? null,
        price: Number(p.price ?? 0),
        deposit: Number(p.deposit ?? 0),
        lens_addon_price: p.lens_addon_price != null ? Number(p.lens_addon_price) : null,
        remaining: Math.max(0, Number(p.qty ?? 0) - (bookedCount[String(p.id)] ?? 0)),
      }))
      .sort((a, b) => b.remaining - a.remaining);

    return NextResponse.json(
      { phones },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "server_error";
    console.error("GET /api/sessions/[id]/phones error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}