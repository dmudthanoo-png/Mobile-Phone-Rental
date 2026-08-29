import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { findOrCreateLineUser } from "@/lib/lineSession";
import { PRIVACY_NOTICE_VERSION } from "@/lib/privacyNotice";

export const runtime = "nodejs"; // ✅ สำคัญ: crypto ใช้บน node runtime
export const dynamic = "force-dynamic";
export const revalidate = 0;

// เวลาที่กันเครื่องไว้ให้ (วินาที) — เผื่อมากกว่าเวลานับถอยหลังหน้าโอนเงิน (5 นาที) ไว้หน่อย
// กันเคสหมดอายุพอดีตอนลูกค้ากำลังกดยืนยัน
const HOLD_SECONDS = 7 * 60;

function base64urlToBuffer(b64url: string) {
  const b64 =
    b64url.replace(/-/g, "+").replace(/_/g, "/") +
    "===".slice((b64url.length + 3) % 4);
  return Buffer.from(b64, "base64");
}

function verifySessionJWT(token: string, secret: string) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [h, p, s] = parts;
  const data = `${h}.${p}`;

  const expected = crypto.createHmac("sha256", secret).update(data).digest();
  const given = base64urlToBuffer(s);

  if (expected.length !== given.length) return null;
  if (!crypto.timingSafeEqual(expected, given)) return null;

  const payloadJson = Buffer.from(
    p.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((p.length + 3) % 4),
    "base64"
  ).toString("utf8");

  const payload = JSON.parse(payloadJson) as { exp?: number; [k: string]: unknown };
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now > payload.exp) return null;

  return payload;
}

async function getAuthedUser(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const sessionSecret = process.env.APP_SESSION_SECRET;
  if (!url || !serviceKey || !sessionSecret) return { error: "missing env" as const, status: 500 };

  const token = req.cookies.get("app_session")?.value;
  if (!token) return { error: "unauthorized" as const, status: 401 };

  const payload = verifySessionJWT(token, sessionSecret);
  const lineSub = typeof payload?.line_sub === "string" ? payload.line_sub : null;
  if (!lineSub) return { error: "unauthorized" as const, status: 401 };

  const supabase = createClient(url, serviceKey);
  const linked = await findOrCreateLineUser(
    supabase,
    lineSub,
    typeof payload?.name === "string" ? payload.name : null,
    typeof payload?.picture === "string" ? payload.picture : null
  );
  if ("error" in linked) return { error: linked.error, status: 500 };

  return { supabase, userId: linked.userId };
}

// POST /api/bookings/reserve — "กันเครื่องไว้ก่อน" ตอนลูกค้ากดต่อจากหน้ากรอกข้อมูลไปหน้าโอนเงิน
// ตัดสต็อกทันทีแบบมีวันหมดอายุ เพื่อให้ "ถ้าเห็นเลขบัญชี = ได้เครื่องแน่นอน" ไม่ต้องลุ้นว่าโอนแล้วจะโดนตัดหน้า
export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthedUser(req);
    if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const { supabase, userId } = auth;

    const body = await req.json().catch(() => null);
    const session_id = String((body as Record<string, unknown>)?.session_id ?? "").trim();
    const phone_id = String((body as Record<string, unknown>)?.phone_id ?? "").trim();
    const renter_name = String((body as Record<string, unknown>)?.renter_name ?? "").trim();
    const renter_phone = String((body as Record<string, unknown>)?.renter_phone ?? "").trim();
    const lens_id = String((body as Record<string, unknown>)?.lens_id ?? "").trim() || null;

    let qty = Number((body as Record<string, unknown>)?.qty ?? 1);
    if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty < 1) qty = 1;
    qty = Math.min(qty, 10);

    let lens_qty = Number((body as Record<string, unknown>)?.lens_qty ?? 0);
    if (!Number.isFinite(lens_qty) || !Number.isInteger(lens_qty) || lens_qty < 0) lens_qty = 0;
    lens_qty = Math.min(lens_qty, 10);
    if (!lens_id) lens_qty = 0;

    if (!session_id) return NextResponse.json({ error: "missing session_id" }, { status: 400 });
    if (!phone_id) return NextResponse.json({ error: "missing phone_id" }, { status: 400 });
    if (!renter_name) return NextResponse.json({ error: "missing renter_name" }, { status: 400 });
    if (!renter_phone) return NextResponse.json({ error: "missing renter_phone" }, { status: 400 });

    // ต้องรับทราบนโยบายความเป็นส่วนตัวก่อน (ด่านเดียวกับตอนสร้างการจองจริง)
    const { data: ack, error: ackErr } = await supabase
      .from("privacy_notice_acknowledgements")
      .select("user_id")
      .eq("user_id", userId)
      .eq("policy_version", PRIVACY_NOTICE_VERSION)
      .maybeSingle();
    if (ackErr) return NextResponse.json({ error: ackErr.message }, { status: 500 });
    if (!ack) return NextResponse.json({ error: "privacy_notice_not_acknowledged" }, { status: 403 });

    // เช็ครอบ/คอนเสิร์ตว่ายังจองได้จริง (ด่านเดียวกับ upload-slip กันจองข้ามขั้นตอน)
    const { data: sessionCheck, error: sessionErr } = await supabase
      .from("concert_sessions")
      .select("id, start_at, concerts ( archived, is_visible, publish_at )")
      .eq("id", session_id)
      .maybeSingle();
    if (sessionErr) return NextResponse.json({ error: sessionErr.message }, { status: 500 });
    if (!sessionCheck) return NextResponse.json({ error: "session not found" }, { status: 404 });
    const concertRow = sessionCheck.concerts as unknown as { archived: boolean; is_visible: boolean | null; publish_at: string | null } | null;
    if (concertRow?.archived) return NextResponse.json({ error: "concert archived" }, { status: 400 });
    if (concertRow?.is_visible === false) return NextResponse.json({ error: "concert hidden" }, { status: 400 });
    if (concertRow?.publish_at && new Date(concertRow.publish_at).getTime() > Date.now()) {
      return NextResponse.json({ error: "concert not published yet" }, { status: 400 });
    }
    if (sessionCheck.start_at && new Date(sessionCheck.start_at).getTime() < Date.now()) {
      return NextResponse.json({ error: "session already passed" }, { status: 400 });
    }

    // คิดราคาฝั่ง server เอง (ไม่เชื่อ client) — รองรับราคาเฉพาะรอบด้วย
    const [{ data: phoneRow, error: phoneErr }, { data: priceRow, error: priceErr }] = await Promise.all([
      supabase.from("phones").select("price, deposit").eq("id", phone_id).eq("active", true).maybeSingle(),
      supabase.from("session_phone_inventory").select("price_override").eq("session_id", session_id).eq("phone_id", phone_id).maybeSingle(),
    ]);
    if (phoneErr) return NextResponse.json({ error: phoneErr.message }, { status: 500 });
    if (priceErr) return NextResponse.json({ error: priceErr.message }, { status: 500 });
    if (!phoneRow) return NextResponse.json({ error: "phone not found" }, { status: 404 });

    const basePrice = Number(priceRow?.price_override ?? phoneRow.price ?? 0);
    const deposit = Number(phoneRow.deposit ?? 0);

    let lensPrice = 0;
    if (lens_id && lens_qty > 0) {
      const { data: linkRow, error: linkErr } = await supabase
        .from("phone_lenses")
        .select("lens_id, lenses ( price, active )")
        .eq("phone_id", phone_id)
        .eq("lens_id", lens_id)
        .maybeSingle();
      if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 500 });
      const lensInfo = linkRow?.lenses as unknown as { price: number; active: boolean } | null;
      if (!linkRow || !lensInfo || lensInfo.active === false) {
        return NextResponse.json({ error: "lens not available for this phone" }, { status: 400 });
      }
      lensPrice = Number(lensInfo.price ?? 0);
    }

    const totalAmount = Math.round(basePrice * qty + deposit * qty + lensPrice * lens_qty);

    const { data, error } = await supabase.rpc("create_booking_hold", {
      p_user_id: userId,
      p_session_id: session_id,
      p_phone_id: phone_id,
      p_qty: qty,
      p_lens_id: lens_id,
      p_lens_qty: lens_qty,
      p_renter_name: renter_name,
      p_renter_phone: renter_phone,
      p_total_amount: totalAmount,
      p_deposit_amount: Math.round(deposit * qty),
      p_hold_seconds: HOLD_SECONDS,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const result = data as { ok?: boolean; error?: string; booking_id?: string; expires_at?: string } | null;
    const errCode = result?.error;
    if (errCode) {
      if (errCode === "SOLD_OUT_PHONE" || errCode === "PHONE_NOT_CONFIGURED_FOR_SESSION") {
        return NextResponse.json({ error: "sold_out" }, { status: 409 });
      }
      if (errCode === "SOLD_OUT_LENS" || errCode === "LENS_NOT_CONFIGURED_FOR_SESSION") {
        return NextResponse.json({ error: "lens_sold_out" }, { status: 409 });
      }
      if (errCode === "TOO_MANY_PENDING") {
        return NextResponse.json(
          { error: "มีการจองที่รอยืนยันอยู่แล้ว กรุณารอให้แอดมินตรวจสอบก่อน" },
          { status: 429 }
        );
      }
      return NextResponse.json({ error: errCode }, { status: 400 });
    }

    return NextResponse.json(
      { ok: true, booking_id: result?.booking_id ?? null, expires_at: result?.expires_at ?? null, total_amount: totalAmount },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: unknown) {
    console.error("reserve (hold) fatal error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "server_error" }, { status: 500 });
  }
}

// DELETE /api/bookings/reserve — คืนเครื่องที่กันไว้ (ลูกค้ากดย้อนกลับ/ออกจากขั้นตอนจอง)
export async function DELETE(req: NextRequest) {
  try {
    const auth = await getAuthedUser(req);
    if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const { supabase, userId } = auth;

    const { error } = await supabase.rpc("release_booking_hold", { p_user_id: userId });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (err: unknown) {
    console.error("release hold fatal error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "server_error" }, { status: 500 });
  }
}
