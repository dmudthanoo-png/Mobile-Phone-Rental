import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs"; // ✅ สำคัญ: crypto ใช้บน node runtime
export const dynamic = "force-dynamic";
export const revalidate = 0;

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

type ReserveBody = {
  session_id: string;
  phone_id: string;
  renter_name: string;
  renter_phone: string;
  total_amount?: number;
};

// A1: endpoint นี้ใช้ "เช็คว่าของยังมี" + ส่งข้อมูลผู้เช่าไปขั้นตอนชำระเงิน
// ✅ ไม่สร้าง booking และไม่ใช้ pending อีกต่อไป
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

    // ✅ กัน client ส่งไม่ใช่ JSON (จะได้ไม่หลุดไป 500 แปลกๆ)
    const ct = req.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      return NextResponse.json(
        { error: "content_type_must_be_json" },
        { status: 415 }
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

    const session_id = String(body.session_id ?? "").trim();
    const phone_id = String(body.phone_id ?? "").trim();
    const renter_name = String(body.renter_name ?? "").trim();
    const renter_phone = String(body.renter_phone ?? "").trim();
    const total_amount = Number(body.total_amount ?? 0);

    if (!session_id || !phone_id || !renter_name || !renter_phone) {
      return NextResponse.json(
        {
          error: "missing required fields",
          missing: {
            session_id: !session_id,
            phone_id: !phone_id,
            renter_name: !renter_name,
            renter_phone: !renter_phone,
          },
        },
        { status: 400 }
      );
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

    // 5) นับ booked เฉพาะ confirmed (A1 ไม่มี pending)
    const bookedRes = await supabaseAdmin
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("session_id", session_id)
      .eq("phone_id", phone_id)
      .eq("status", "confirmed");

    if (bookedRes.error) return NextResponse.json({ error: bookedRes.error.message }, { status: 500 });

    const booked = bookedRes.count ?? 0;
    const remaining = qty - booked;
    if (remaining <= 0) return NextResponse.json({ error: "sold_out" }, { status: 409 });

    // 6) ✅ ไม่สร้าง booking แล้ว — ส่งข้อมูลกลับไปให้ client ไปขั้นตอนชำระเงิน/อัปโหลดสลิป
    return NextResponse.json(
      {
        ok: true,
        remaining,
        session_id,
        phone_id,
        renter_name,
        renter_phone,
        total_amount: Number.isFinite(total_amount) ? total_amount : 0,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: any) {
    console.error("reserve fatal error:", err);
    return NextResponse.json({ error: err?.message || "server_error" }, { status: 500 });
  }
}