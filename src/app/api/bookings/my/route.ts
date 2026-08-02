import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

function base64urlToBuffer(b64url: string) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64url.length + 3) % 4);
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

export async function GET(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const sessionSecret = process.env.APP_SESSION_SECRET;

  if (!url || !serviceKey || !sessionSecret) {
    return NextResponse.json({ error: "missing env" }, { status: 500 });
  }

  const token = req.cookies.get("app_session")?.value;
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const payload = verifySessionJWT(token, sessionSecret);
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const lineSub = payload?.line_sub as string | undefined;
  if (!lineSub) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const supabaseAdmin = createClient(url, serviceKey);

  // ✅ 1) ดึง userId จาก session (ใหม่)
  let userId = payload?.app_user_id as string | undefined;

  // ✅ 2) fallback รองรับ session เก่า: lookup จาก line_identities
  if (!userId) {
    const { data: ident, error: identErr } = await supabaseAdmin
      .from("line_identities")
      .select("user_id")
      .eq("line_sub", lineSub)
      .maybeSingle();

    if (identErr) return NextResponse.json({ error: identErr.message }, { status: 500 });
    userId = ident?.user_id ?? undefined;
  }

  if (!userId) {
    return NextResponse.json(
      { error: "user not linked. please login again." },
      { status: 401 }
    );
  }

  // ✅ 3) ดึง bookings ด้วย user_id (มาตรฐาน)
  // ถ้าอยากได้ profile ด้วย: select("*, profiles(name,picture,phone)")
  const { data, error } = await supabaseAdmin
    .from("bookings")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ bookings: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}