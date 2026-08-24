import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(_req: NextRequest) {
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

    const supabaseAdmin = createClient(url, serviceKey);

    const { data, error } = await supabaseAdmin
      .from("concerts")
      .select("id, title, poster_url, venue_name, description, publish_at, created_at")
      .eq("archived", false)
      .eq("is_visible", true)
      .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // publish_at ในอนาคต = ยังไม่เปิดให้จอง แยกไปอยู่ใน category "เร็วๆ นี้" ต่างหาก
    // (null หรือถึงเวลาแล้ว = เผยแพร่ตามปกติ เหมือนพฤติกรรมเดิมก่อนมีฟีเจอร์นี้)
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const rows = data ?? [];
    const liveConcerts = rows.filter((c) => !c.publish_at || new Date(c.publish_at).getTime() <= now);
    const upcoming = rows
      .filter((c) => c.publish_at && new Date(c.publish_at).getTime() > now)
      .sort((a, b) => new Date(a.publish_at!).getTime() - new Date(b.publish_at!).getTime());

    // เช็คว่าคอนเสิร์ตที่ live อยู่ ยังมีรอบไหนพอจะจองได้บ้างไหม (สต็อกเหลือจริง)
    // แยก 2 กรณีให้ชัด: "เต็มแล้ว" (มีรอบในอนาคต แต่สต็อกหมดทุกรอบ) กับ "no_sessions"
    // (ยังไม่ตั้งรอบเลย หรือรอบที่มีผ่านไปหมดแล้ว) เพราะความหมายไม่เหมือนกัน
    const soldOutIds = new Set<string>();
    const noSessionIds = new Set<string>();
    const nextSessionAtByConcert = new Map<string, string>();
    const liveIds = liveConcerts.map((c) => c.id);

    if (liveIds.length > 0) {
      const { data: sessionRows } = await supabaseAdmin
        .from("concert_sessions")
        .select("id, concert_id, start_at")
        .in("concert_id", liveIds)
        .gte("start_at", nowIso)
        .order("start_at", { ascending: true });

      const sessionsByConcert = new Map<string, string[]>();
      for (const s of sessionRows ?? []) {
        const arr = sessionsByConcert.get(s.concert_id) ?? [];
        arr.push(s.id);
        sessionsByConcert.set(s.concert_id, arr);
        // เรียง start_at ascending มาแล้ว ตัวแรกที่เจอของแต่ละคอนเสิร์ต = รอบที่ใกล้ที่สุด
        if (!nextSessionAtByConcert.has(s.concert_id)) nextSessionAtByConcert.set(s.concert_id, s.start_at);
      }
      const allSessionIds = (sessionRows ?? []).map((s) => s.id);
      const hasStockSessionIds = new Set<string>();

      if (allSessionIds.length > 0) {
        const [{ data: activePhoneRows }, { data: invRows }, { data: bookedRows }] = await Promise.all([
          supabaseAdmin.from("phones").select("id").eq("active", true),
          supabaseAdmin.from("session_phone_inventory").select("session_id, phone_id, qty").in("session_id", allSessionIds),
          supabaseAdmin
            .from("bookings")
            .select("session_id, phone_id, qty")
            .in("session_id", allSessionIds)
            .or(`status.eq.confirmed,and(status.eq.pending,pending_expires_at.is.null),and(status.eq.pending,pending_expires_at.gt.${nowIso})`),
        ]);

        const activePhoneIds = new Set((activePhoneRows ?? []).map((p) => p.id));
        const bookedByKey = new Map<string, number>();
        for (const b of bookedRows ?? []) {
          if (!b.phone_id) continue;
          const key = `${b.session_id}:${b.phone_id}`;
          bookedByKey.set(key, (bookedByKey.get(key) ?? 0) + Number(b.qty ?? 1));
        }
        for (const inv of invRows ?? []) {
          if (!activePhoneIds.has(inv.phone_id)) continue;
          const key = `${inv.session_id}:${inv.phone_id}`;
          const remaining = Number(inv.qty ?? 0) - (bookedByKey.get(key) ?? 0);
          if (remaining > 0) hasStockSessionIds.add(inv.session_id);
        }
      }

      for (const c of liveConcerts) {
        const sIds = sessionsByConcert.get(c.id) ?? [];
        if (sIds.length === 0) {
          // ไม่มีรอบในอนาคตเลย (ยังไม่ตั้งรอบ หรือรอบที่มีผ่านไปหมดแล้ว) — คนละกรณีกับ "เต็มแล้ว"
          // (เต็มแล้ว = มีรอบให้จอง แต่สต็อกหมด) ไม่ควรติดป้ายเดียวกัน เดี๋ยวเข้าใจผิดว่าคนจองเต็ม
          noSessionIds.add(c.id);
          continue;
        }
        const anyStock = sIds.some((sid) => hasStockSessionIds.has(sid));
        if (!anyStock) soldOutIds.add(c.id);
      }
    }

    const concerts = liveConcerts.map((c) => ({
      ...c,
      sold_out: soldOutIds.has(c.id),
      no_sessions: noSessionIds.has(c.id),
      next_session_at: nextSessionAtByConcert.get(c.id) ?? null,
    }));

    return NextResponse.json(
      { concerts, upcoming },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: unknown) {
    console.error("GET /api/concerts error:", err);
    const message = err instanceof Error ? err.message : "server_error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}