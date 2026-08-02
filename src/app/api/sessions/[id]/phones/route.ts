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

    // 1) ดึงมือถือทั้งหมดที่ active
    const { data: phoneRows, error: phoneErr } = await supabase
      .from("phones")
      .select("id, model_name, image_url, price, deposit, qty")
      .eq("active", true)
      .order("model_name");

    if (phoneErr) return NextResponse.json({ error: phoneErr.message }, { status: 500 });
    if (!phoneRows || phoneRows.length === 0) {
      return NextResponse.json({ phones: [] }, { headers: { "Cache-Control": "no-store" } });
    }

    // 2) ดึงเลนส์ที่ผูกกับมือถือแต่ละรุ่น (join ผ่าน phone_lenses)
    const phoneIds = phoneRows.map((p) => p.id);
    const { data: linkRows, error: linkErr } = await supabase
      .from("phone_lenses")
      .select("phone_id, lenses ( id, name, focal_mm, price, qty, active )")
      .in("phone_id", phoneIds);

    if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 500 });

    type LensRow = { id: string; name: string; focal_mm: number | null; price: number; qty: number; active: boolean };
    const lensesByPhone: Record<string, LensRow[]> = {};
    for (const r of linkRows ?? []) {
      const lens = r.lenses as unknown as LensRow | null;
      if (!lens || lens.active === false) continue;
      const arr = lensesByPhone[r.phone_id] ?? [];
      arr.push(lens);
      lensesByPhone[r.phone_id] = arr;
    }

    // 3) นับจำนวนมือถือที่ถูกจองอยู่ (confirmed + pending) เฉพาะ "รอบนี้" เท่านั้น
    //    (มือถือ/เลนส์คืนหลังจบแต่ละรอบ ดังนั้นสต็อกต้องรีเซ็ตต่อรอบ ไม่ใช่รวมทุกรอบของคอนเสิร์ต)
    const { data: bookedRows, error: bkErr } = await supabase
      .from("bookings")
      .select("phone_id, qty, lens_id, lens_qty")
      .eq("session_id", sessionId)
      .in("status", ["confirmed", "pending"]);

    if (bkErr) return NextResponse.json({ error: bkErr.message }, { status: 500 });

    const phoneBookedQty: Record<string, number> = {};
    const lensBookedQty: Record<string, number> = {};
    for (const r of bookedRows ?? []) {
      if (r.phone_id) {
        phoneBookedQty[r.phone_id] = (phoneBookedQty[r.phone_id] || 0) + Number(r.qty ?? 1);
      }
      if (r.lens_id) {
        lensBookedQty[r.lens_id] = (lensBookedQty[r.lens_id] || 0) + Number(r.lens_qty ?? 0);
      }
    }

    // 4) ประกอบผลลัพธ์: มือถือ + remaining + รายการเลนส์ที่เลือกได้ (พร้อม remaining ของแต่ละเลนส์)
    const phones = phoneRows
      .map((p) => {
        const lensOptions = (lensesByPhone[p.id] ?? [])
          .map((l) => ({
            lens_id: l.id,
            name: l.name,
            focal_mm: l.focal_mm,
            price: Number(l.price ?? 0),
            remaining: Math.max(0, Number(l.qty ?? 0) - (lensBookedQty[l.id] ?? 0)),
          }))
          .sort((a, b) => (a.focal_mm ?? 0) - (b.focal_mm ?? 0));

        return {
          phone_id: String(p.id),
          model_name: String(p.model_name ?? ""),
          image_url: p.image_url ?? null,
          price: Number(p.price ?? 0),
          deposit: Number(p.deposit ?? 0),
          remaining: Math.max(0, Number(p.qty ?? 0) - (phoneBookedQty[p.id] ?? 0)),
          lens_options: lensOptions,
        };
      })
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
