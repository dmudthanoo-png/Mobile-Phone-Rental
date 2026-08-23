import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/adminAuth";
import { logAdminAction } from "@/lib/adminAudit";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceKey);
}

// หาช่วงเวลา "วันเดียวกัน" ของ session นี้ ตามเวลาไทย (UTC+7 ไม่มี DST)
// ใช้กำหนดว่า session ไหนบ้างถือว่า "แย่งสต็อกชุดเดียวกัน" กับ session นี้
function getThaiDayRangeUtc(iso: string): { start: string; end: string } {
  const d = new Date(iso);
  const thaiDateStr = d.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" }); // YYYY-MM-DD
  const dayStart = new Date(`${thaiDateStr}T00:00:00+07:00`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  return { start: dayStart.toISOString(), end: dayEnd.toISOString() };
}

type PhoneQuotaInfo = {
  phone_id: string;
  model_name: string;
  total_qty: number;
  allocated_elsewhere: number;
  available_to_allocate: number;
  current_quota: number | null;
  already_booked: number;
};

// GET /api/admin/sessions/[sessionId]/quota — ดูโควต้ามือถือของรอบนี้ + เหลือให้จัดสรรได้อีกเท่าไหร่
// (คำนวณจากรอบอื่นที่ "วันเดียวกัน" เท่านั้น รอบวันอื่นไม่กระทบกันเพราะเครื่องคืนแล้วใช้ซ้ำได้)
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ sessionId?: string }> }
) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { sessionId } = await ctx.params;
  if (!sessionId) return NextResponse.json({ error: "missing sessionId" }, { status: 400 });

  const supabase = getSupabase();

  const { data: session, error: sessionErr } = await supabase
    .from("concert_sessions")
    .select("id, start_at")
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionErr) return NextResponse.json({ error: sessionErr.message }, { status: 500 });
  if (!session?.start_at) return NextResponse.json({ error: "ไม่พบรอบนี้ หรือยังไม่ได้ตั้งวันเวลา" }, { status: 404 });

  const { start, end } = getThaiDayRangeUtc(session.start_at);

  // รอบอื่นๆ (ไม่รวมรอบนี้เอง) ที่วันเดียวกัน
  const { data: sameDaySessions, error: sameDayErr } = await supabase
    .from("concert_sessions")
    .select("id")
    .gte("start_at", start)
    .lt("start_at", end)
    .neq("id", sessionId);

  if (sameDayErr) return NextResponse.json({ error: sameDayErr.message }, { status: 500 });
  const sameDaySessionIds = (sameDaySessions ?? []).map((s) => s.id);

  const { data: phones, error: phonesErr } = await supabase
    .from("phones")
    .select("id, model_name, qty")
    .eq("active", true)
    .order("model_name", { ascending: true });

  if (phonesErr) return NextResponse.json({ error: phonesErr.message }, { status: 500 });

  const phoneIds = (phones ?? []).map((p) => p.id);
  if (phoneIds.length === 0) {
    return NextResponse.json({ session_start_at: session.start_at, phones: [] });
  }

  // โควต้าที่ให้รอบอื่น (วันเดียวกัน) ไปแล้ว
  const elsewhereByPhone: Record<string, number> = {};
  if (sameDaySessionIds.length > 0) {
    const { data: elsewhereRows, error: elsewhereErr } = await supabase
      .from("session_phone_inventory")
      .select("phone_id, qty")
      .in("session_id", sameDaySessionIds)
      .in("phone_id", phoneIds);

    if (elsewhereErr) return NextResponse.json({ error: elsewhereErr.message }, { status: 500 });
    for (const r of elsewhereRows ?? []) {
      elsewhereByPhone[r.phone_id] = (elsewhereByPhone[r.phone_id] ?? 0) + Number(r.qty ?? 0);
    }
  }

  // โควต้าปัจจุบันของรอบนี้เอง
  const { data: currentRows, error: currentErr } = await supabase
    .from("session_phone_inventory")
    .select("phone_id, qty")
    .eq("session_id", sessionId)
    .in("phone_id", phoneIds);

  if (currentErr) return NextResponse.json({ error: currentErr.message }, { status: 500 });
  const currentByPhone: Record<string, number> = {};
  for (const r of currentRows ?? []) currentByPhone[r.phone_id] = Number(r.qty ?? 0);

  // ยอดที่ถูกจองไปแล้วจริงของรอบนี้ (กันตั้งโควต้าต่ำกว่ายอดจอง)
  const nowIso = new Date().toISOString();
  const { data: bookedRows, error: bookedErr } = await supabase
    .from("bookings")
    .select("phone_id, qty")
    .eq("session_id", sessionId)
    .in("phone_id", phoneIds)
    .or(
      `status.eq.confirmed,status.eq.pending.and(pending_expires_at.is.null),status.eq.pending.and(pending_expires_at.gt.${nowIso})`
    );

  if (bookedErr) return NextResponse.json({ error: bookedErr.message }, { status: 500 });
  const bookedByPhone: Record<string, number> = {};
  for (const r of bookedRows ?? []) {
    if (r.phone_id) bookedByPhone[r.phone_id] = (bookedByPhone[r.phone_id] ?? 0) + Number(r.qty ?? 1);
  }

  const result: PhoneQuotaInfo[] = (phones ?? []).map((p) => {
    const totalQty = Number(p.qty ?? 0);
    const allocatedElsewhere = elsewhereByPhone[p.id] ?? 0;
    return {
      phone_id: p.id,
      model_name: p.model_name,
      total_qty: totalQty,
      allocated_elsewhere: allocatedElsewhere,
      available_to_allocate: Math.max(0, totalQty - allocatedElsewhere),
      current_quota: currentByPhone[p.id] ?? null,
      already_booked: bookedByPhone[p.id] ?? 0,
    };
  });

  return NextResponse.json({ session_start_at: session.start_at, phones: result });
}

// POST /api/admin/sessions/[sessionId]/quota — ตั้ง/แก้โควต้ามือถือของรอบนี้
// body: { items: [{ phone_id, qty }] }
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ sessionId?: string }> }
) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { sessionId } = await ctx.params;
  if (!sessionId) return NextResponse.json({ error: "missing sessionId" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const items = (body as { items?: { phone_id?: string; qty?: unknown }[] } | null)?.items;
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "items must be a non-empty array" }, { status: 400 });
  }

  const supabase = getSupabase();

  const { data: session, error: sessionErr } = await supabase
    .from("concert_sessions")
    .select("id, start_at")
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionErr) return NextResponse.json({ error: sessionErr.message }, { status: 500 });
  if (!session?.start_at) return NextResponse.json({ error: "ไม่พบรอบนี้ หรือยังไม่ได้ตั้งวันเวลา" }, { status: 404 });

  const { start, end } = getThaiDayRangeUtc(session.start_at);

  const { data: sameDaySessions, error: sameDayErr } = await supabase
    .from("concert_sessions")
    .select("id")
    .gte("start_at", start)
    .lt("start_at", end)
    .neq("id", sessionId);

  if (sameDayErr) return NextResponse.json({ error: sameDayErr.message }, { status: 500 });
  const sameDaySessionIds = (sameDaySessions ?? []).map((s) => s.id);

  const nowIso = new Date().toISOString();

  for (const item of items) {
    const phoneId = String(item.phone_id ?? "").trim();
    const qty = Number(item.qty);
    if (!phoneId) return NextResponse.json({ error: "each item must have phone_id" }, { status: 400 });
    if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty < 0) {
      return NextResponse.json({ error: `invalid qty for phone_id ${phoneId}` }, { status: 400 });
    }

    const { data: phone, error: phoneErr } = await supabase
      .from("phones")
      .select("qty")
      .eq("id", phoneId)
      .maybeSingle();
    if (phoneErr) return NextResponse.json({ error: phoneErr.message }, { status: 500 });
    if (!phone) return NextResponse.json({ error: `ไม่พบมือถือ id ${phoneId}` }, { status: 404 });

    // 1) ห้ามตั้งต่ำกว่ายอดที่ถูกจองไปแล้วจริงของรอบนี้ (รวม qty ต่อรายการ ไม่ใช่แค่นับจำนวนแถว
    //    เพราะ 1 booking อาจจองมากกว่า 1 เครื่อง)
    const { data: bookedRowsForPhone, error: bookedErr } = await supabase
      .from("bookings")
      .select("qty")
      .eq("session_id", sessionId)
      .eq("phone_id", phoneId)
      .or(
        `status.eq.confirmed,status.eq.pending.and(pending_expires_at.is.null),status.eq.pending.and(pending_expires_at.gt.${nowIso})`
      );
    if (bookedErr) return NextResponse.json({ error: bookedErr.message }, { status: 500 });
    const bookedQtySum = (bookedRowsForPhone ?? []).reduce((sum, r) => sum + Number(r.qty ?? 1), 0);
    if (qty < bookedQtySum) {
      return NextResponse.json(
        { error: `phone_id ${phoneId} ตั้งได้ต่ำสุด ${bookedQtySum} เพราะมีการจองอยู่แล้ว ${bookedQtySum} เครื่อง` },
        { status: 400 }
      );
    }

    // 2) ห้ามตั้งให้รวมกับโควต้าที่ให้รอบอื่น (วันเดียวกัน) แล้วเกินจำนวนที่ร้านมีจริง
    let allocatedElsewhere = 0;
    if (sameDaySessionIds.length > 0) {
      const { data: elsewhereRows, error: elsewhereErr } = await supabase
        .from("session_phone_inventory")
        .select("qty")
        .in("session_id", sameDaySessionIds)
        .eq("phone_id", phoneId);
      if (elsewhereErr) return NextResponse.json({ error: elsewhereErr.message }, { status: 500 });
      allocatedElsewhere = (elsewhereRows ?? []).reduce((sum, r) => sum + Number(r.qty ?? 0), 0);
    }

    const availableToAllocate = Number(phone.qty ?? 0) - allocatedElsewhere;
    if (qty > availableToAllocate) {
      return NextResponse.json(
        {
          error: `phone_id ${phoneId} ตั้งได้สูงสุด ${availableToAllocate} เพราะมีรอบอื่นในวันเดียวกันจัดสรรไปแล้ว ${allocatedElsewhere} จากทั้งหมด ${phone.qty}`,
        },
        { status: 400 }
      );
    }

    const { error: upsertErr } = await supabase
      .from("session_phone_inventory")
      .upsert({ session_id: sessionId, phone_id: phoneId, qty }, { onConflict: "session_id,phone_id" });
    if (upsertErr) return NextResponse.json({ error: upsertErr.message }, { status: 500 });
  }

  await logAdminAction({
    username: String(admin.payload.username ?? ""),
    action: "ตั้งโควต้ามือถือของรอบ",
    detail: `session_id: ${sessionId}, items: ${items.length} รายการ`,
  });

  return NextResponse.json({ ok: true });
}
