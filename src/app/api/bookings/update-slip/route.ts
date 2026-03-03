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

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const sessionSecret = process.env.APP_SESSION_SECRET;

  if (!url || !serviceKey || !sessionSecret) {
    return NextResponse.json({ error: "missing env" }, { status: 500 });
  }

  const token = req.cookies.get("app_session")?.value;
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const payload = verifySessionJWT(token, sessionSecret);
  const lineSub = payload?.line_sub as string | undefined;
  if (!lineSub) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await req.formData();
  const bookingId = String(form.get("booking_id") ?? "");
  const slip = form.get("slip");

  if (!bookingId) return NextResponse.json({ error: "missing booking_id" }, { status: 400 });
  if (!(slip instanceof File)) return NextResponse.json({ error: "missing slip file" }, { status: 400 });

  const supabaseAdmin = createClient(url, serviceKey);

  // เช็คว่า booking นี้เป็นของ user และต้อง pending เท่านั้น
  const { data: bk, error: bkErr } = await supabaseAdmin
    .from("bookings")
    .select("id,line_sub,status")
    .eq("id", bookingId)
    .single();

  if (bkErr || !bk) return NextResponse.json({ error: "booking not found" }, { status: 404 });
  if (bk.line_sub !== lineSub) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (bk.status !== "pending") return NextResponse.json({ error: "only pending can update slip" }, { status: 400 });

  const ext = slip.type === "image/png" ? "png" : "jpg";
  const fileName = `${lineSub}_${Date.now()}.${ext}`;
  const buffer = Buffer.from(await slip.arrayBuffer());

  const { error: upErr } = await supabaseAdmin.storage.from("slips").upload(fileName, buffer, {
    contentType: slip.type,
    upsert: true,
  });

  if (upErr) return NextResponse.json({ error: `upload failed: ${upErr.message}` }, { status: 500 });

  const { data: pub } = supabaseAdmin.storage.from("slips").getPublicUrl(fileName);
  const slipUrl = pub.publicUrl;

  const { error: upRowErr } = await supabaseAdmin
    .from("bookings")
    .update({ slip_url: slipUrl })
    .eq("id", bookingId);

  if (upRowErr) return NextResponse.json({ error: `update failed: ${upRowErr.message}` }, { status: 500 });

  return NextResponse.json({ ok: true, slip_url: slipUrl });
}