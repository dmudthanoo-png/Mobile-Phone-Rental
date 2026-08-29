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
  default_price: number;
  price_override: number | null;
};

type LensQuotaInfo = {
  lens_id: string;
  name: string;
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
    .select("id, model_name, qty, price")
    .eq("active", true)
    .order("model_name", { ascending: true });

  if (phonesErr) return NextResponse.json({ error: phonesErr.message }, { status: 500 });

  const { data: lenses, error: lensesErr } = await supabase
    .from("lenses")
    .select("id, name, qty")
    .eq("active", true)
    .order("name", { ascending: true });

  if (lensesErr) return NextResponse.json({ error: lensesErr.message }, { status: 500 });

  const phoneIds = (phones ?? []).map((p) => p.id);
  const lensIds = (lenses ?? []).map((l) => l.id);
  const nowIso = new Date().toISOString();

  let phoneResult: PhoneQuotaInfo[] = [];
  if (phoneIds.length > 0) {
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

    // โควต้า + ราคาเฉพาะรอบ (ถ้าตั้งไว้) ของรอบนี้เอง
    const { data: currentRows, error: currentErr } = await supabase
      .from("session_phone_inventory")
      .select("phone_id, qty, price_override")
      .eq("session_id", sessionId)
      .in("phone_id", phoneIds);

    if (currentErr) return NextResponse.json({ error: currentErr.message }, { status: 500 });
    const currentByPhone: Record<string, number> = {};
    const priceOverrideByPhone: Record<string, number | null> = {};
    for (const r of currentRows ?? []) {
      currentByPhone[r.phone_id] = Number(r.qty ?? 0);
      priceOverrideByPhone[r.phone_id] = r.price_override != null ? Number(r.price_override) : null;
    }

    // ยอดที่ถูกจองไปแล้วจริงของรอบนี้ (กันตั้งโควต้าต่ำกว่ายอดจอง)
    const { data: bookedRows, error: bookedErr } = await supabase
      .from("bookings")
      .select("phone_id, qty")
      .eq("session_id", sessionId)
      .in("phone_id", phoneIds)
      .or(
        `status.eq.confirmed,and(status.eq.pending,pending_expires_at.is.null),and(status.eq.pending,pending_expires_at.gt.${nowIso})`
      );

    if (bookedErr) return NextResponse.json({ error: bookedErr.message }, { status: 500 });
    const bookedByPhone: Record<string, number> = {};
    for (const r of bookedRows ?? []) {
      if (r.phone_id) bookedByPhone[r.phone_id] = (bookedByPhone[r.phone_id] ?? 0) + Number(r.qty ?? 1);
    }

    phoneResult = (phones ?? []).map((p) => {
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
        default_price: Number(p.price ?? 0),
        price_override: priceOverrideByPhone[p.id] ?? null,
      };
    });
  }

  let lensResult: LensQuotaInfo[] = [];
  if (lensIds.length > 0) {
    const elsewhereByLens: Record<string, number> = {};
    if (sameDaySessionIds.length > 0) {
      const { data: elsewhereRows, error: elsewhereErr } = await supabase
        .from("session_lens_inventory")
        .select("lens_id, qty")
        .in("session_id", sameDaySessionIds)
        .in("lens_id", lensIds);

      if (elsewhereErr) return NextResponse.json({ error: elsewhereErr.message }, { status: 500 });
      for (const r of elsewhereRows ?? []) {
        elsewhereByLens[r.lens_id] = (elsewhereByLens[r.lens_id] ?? 0) + Number(r.qty ?? 0);
      }
    }

    const { data: currentRows, error: currentErr } = await supabase
      .from("session_lens_inventory")
      .select("lens_id, qty")
      .eq("session_id", sessionId)
      .in("lens_id", lensIds);

    if (currentErr) return NextResponse.json({ error: currentErr.message }, { status: 500 });
    const currentByLens: Record<string, number> = {};
    for (const r of currentRows ?? []) currentByLens[r.lens_id] = Number(r.qty ?? 0);

    const { data: bookedRows, error: bookedErr } = await supabase
      .from("bookings")
      .select("lens_id, lens_qty")
      .eq("session_id", sessionId)
      .in("lens_id", lensIds)
      .or(
        `status.eq.confirmed,and(status.eq.pending,pending_expires_at.is.null),and(status.eq.pending,pending_expires_at.gt.${nowIso})`
      );

    if (bookedErr) return NextResponse.json({ error: bookedErr.message }, { status: 500 });
    const bookedByLens: Record<string, number> = {};
    for (const r of bookedRows ?? []) {
      if (r.lens_id) bookedByLens[r.lens_id] = (bookedByLens[r.lens_id] ?? 0) + Number(r.lens_qty ?? 0);
    }

    lensResult = (lenses ?? []).map((l) => {
      const totalQty = Number(l.qty ?? 0);
      const allocatedElsewhere = elsewhereByLens[l.id] ?? 0;
      return {
        lens_id: l.id,
        name: l.name,
        total_qty: totalQty,
        allocated_elsewhere: allocatedElsewhere,
        available_to_allocate: Math.max(0, totalQty - allocatedElsewhere),
        current_quota: currentByLens[l.id] ?? null,
        already_booked: bookedByLens[l.id] ?? 0,
      };
    });
  }

  return NextResponse.json({ session_start_at: session.start_at, phones: phoneResult, lenses: lensResult });
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
  const items = (body as { items?: { phone_id?: string; qty?: unknown; price_override?: unknown }[] } | null)?.items ?? [];
  const lensItems = (body as { lens_items?: { lens_id?: string; qty?: unknown }[] } | null)?.lens_items ?? [];
  if (items.length === 0 && lensItems.length === 0) {
    return NextResponse.json({ error: "items หรือ lens_items ต้องมีอย่างน้อย 1 รายการ" }, { status: 400 });
  }

  const supabase = getSupabase();

  // price_override: null/"" = ใช้ราคาตั้งต้นของรุ่น, ตัวเลข = ใช้ราคานั้นเฉพาะรอบนี้
  const normalizePriceOverride = (raw: unknown): number | null => {
    if (raw === null || raw === undefined || raw === "") return null;
    return Number(raw);
  };

  // validate ก่อนส่งเข้า RPC
  for (const item of items) {
    const phoneId = String(item.phone_id ?? "").trim();
    const qty = Number(item.qty);
    if (!phoneId) return NextResponse.json({ error: "each item must have phone_id" }, { status: 400 });
    if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty < 0) {
      return NextResponse.json({ error: `invalid qty for phone_id ${phoneId}` }, { status: 400 });
    }
    const price = normalizePriceOverride(item.price_override);
    if (price !== null && (!Number.isFinite(price) || !Number.isInteger(price) || price < 0)) {
      return NextResponse.json({ error: `invalid price_override for phone_id ${phoneId}` }, { status: 400 });
    }
  }
  for (const item of lensItems) {
    const lensId = String(item.lens_id ?? "").trim();
    const qty = Number(item.qty);
    if (!lensId) return NextResponse.json({ error: "each lens item must have lens_id" }, { status: 400 });
    if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty < 0) {
      return NextResponse.json({ error: `invalid qty for lens_id ${lensId}` }, { status: 400 });
    }
  }

  // ตั้งโควต้ามือถือ+เลนส์ทั้งหมดในคำสั่งเดียวแบบ atomic — ผิดรายการไหนก็ยกเลิกทั้งหมด ไม่ให้
  // รายการก่อนหน้าที่สำเร็จไปแล้วค้างอยู่ (ดู scripts/fix_lens_quota_backfill_and_atomic_batch.sql)
  const { error } = await supabase.rpc("set_session_quota_batch", {
    p_session_id: sessionId,
    p_phone_items: items.map((it) => ({
      phone_id: String(it.phone_id ?? "").trim(),
      qty: Number(it.qty),
      price_override: normalizePriceOverride(it.price_override),
    })),
    p_lens_items: lensItems.map((it) => ({ lens_id: String(it.lens_id ?? "").trim(), qty: Number(it.qty) })),
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  await logAdminAction({
    username: String(admin.payload.username ?? ""),
    action: "ตั้งโควต้าของรอบ",
    detail: `session_id: ${sessionId}, มือถือ: ${items.length} รายการ, เลนส์: ${lensItems.length} รายการ`,
  });

  return NextResponse.json({ ok: true });
}
