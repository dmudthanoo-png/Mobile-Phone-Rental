import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

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

  const payload = JSON.parse(payloadJson) as { exp?: number; [k: string]: any };
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now > payload.exp) return null;

  return payload;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ReserveBody = {
  session_id: string;
  phone_id: string;
  renter_name: string;
  renter_phone: string;
  total_amount?: number; // optional
};

export async function POST(req: NextRequest) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const sessionSecret = process.env.APP_SESSION_SECRET;

    if (!url || !serviceKey || !sessionSecret) {
      return NextResponse.json(
        {
          error: "missing env",
          missing: {
            NEXT_PUBLIC_SUPABASE_URL: !url,
            SUPABASE_SERVICE_ROLE_KEY: !serviceKey,
            APP_SESSION_SECRET: !sessionSecret,
          },
        },
        { status: 500 }
      );
    }

    // 1) verify user session
    const token = req.cookies.get("app_session")?.value;
    if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const payload = verifySessionJWT(token, sessionSecret);
    const lineSub = payload?.line_sub as string | undefined;
    if (!lineSub) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    // 2) parse body
    const body = (await req.json()) as Partial<ReserveBody>;
    const session_id = String(body.session_id ?? "");
    const phone_id = String(body.phone_id ?? "");
    const renter_name = String(body.renter_name ?? "").trim();
    const renter_phone = String(body.renter_phone ?? "").trim();
    const total_amount = Number(body.total_amount ?? 0);

    if (!session_id || !phone_id || !renter_name || !renter_phone) {
      return NextResponse.json({ error: "missing required fields" }, { status: 400 });
    }

    const supabaseAdmin = createClient(url, serviceKey);

    // 3) หา profiles.id จาก line_sub => user_id
    const prof = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("line_sub", lineSub)
      .maybeSingle();

    if (prof.error) return NextResponse.json({ error: prof.error.message }, { status: 500 });

    const user_id = prof.data?.id as string | undefined;
    if (!user_id) return NextResponse.json({ error: "profile_not_found" }, { status: 400 });

    // 4) เช็ค inventory.qty ของรอบนี้ + รุ่นนี้
    const inv = await supabaseAdmin
      .from("session_phone_inventory")
      .select("qty")
      .eq("session_id", session_id)
      .eq("phone_id", phone_id)
      .maybeSingle();

    if (inv.error) return NextResponse.json({ error: inv.error.message }, { status: 500 });

    const qty = Number(inv.data?.qty ?? 0);
    if (qty <= 0) return NextResponse.json({ error: "sold_out" }, { status: 409 });

    // 5) นับ booked (confirmed + pending active)
    // pending active = pending_expires_at is null OR pending_expires_at > now()
    const nowIso = new Date().toISOString();

    const bookedRes = await supabaseAdmin
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("session_id", session_id)
      .eq("phone_id", phone_id)
      .or(
        `status.eq.confirmed,status.eq.pending.and(pending_expires_at.is.null),status.eq.pending.and(pending_expires_at.gt.${nowIso})`
      );

    if (bookedRes.error) return NextResponse.json({ error: bookedRes.error.message }, { status: 500 });

    const booked = bookedRes.count ?? 0;
    const remaining = qty - booked;

    if (remaining <= 0) return NextResponse.json({ error: "sold_out" }, { status: 409 });

    // 6) insert booking pending + set expires (30 นาที)
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const ref_number = `RT-${Math.floor(100000 + Math.random() * 900000)}`;

    const ins = await supabaseAdmin
      .from("bookings")
      .insert({
        user_id,
        line_sub: lineSub,
        session_id,
        phone_id,
        renter_name,
        renter_phone,
        total_amount: total_amount || 0,
        slip_url: null,
        slip_uploaded_at: null,
        status: "pending",
        pending_expires_at: expiresAt.toISOString(),
        ref_number,
      })
      .select("id, pending_expires_at, ref_number")
      .single();

    if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });

    return NextResponse.json(
      {
        ok: true,
        booking_id: ins.data.id,
        ref_number: ins.data.ref_number,
        expires_at: ins.data.pending_expires_at,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: any) {
    console.error("reserve fatal error:", err);
    return NextResponse.json({ error: err?.message || "server_error" }, { status: 500 });
  }
}