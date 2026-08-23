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

  const payload = JSON.parse(payloadJson) as { exp?: number; [k: string]: unknown };
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now > payload.exp) return null;
  return payload;
}

type BookingForReview = {
  id: string;
  user_id: string | null;
  status: string | null;
  concert_sessions: { concerts: { title: string | null } | null } | null;
};

// POST /api/bookings/submit — ลูกค้าที่ล็อกอินอยู่ส่งรีวิวสำหรับ booking ที่ยืนยันแล้วของตัวเอง
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
  const lineSub = typeof payload?.line_sub === "string" ? payload.line_sub : null;
  if (!lineSub) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const bookingId = typeof body?.booking_id === "string" ? body.booking_id : null;
  const displayName = typeof body?.display_name === "string" ? body.display_name.trim().slice(0, 60) : "";
  const rating = Number(body?.rating);
  const comment = typeof body?.comment === "string" ? body.comment.trim().slice(0, 1000) : "";

  if (!bookingId) return NextResponse.json({ error: "missing booking_id" }, { status: 400 });
  if (!displayName) return NextResponse.json({ error: "missing display_name" }, { status: 400 });
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: "invalid rating" }, { status: 400 });
  }
  if (!comment) return NextResponse.json({ error: "missing comment" }, { status: 400 });

  const supabaseAdmin = createClient(url, serviceKey);

  const { data: ident, error: identErr } = await supabaseAdmin
    .from("line_identities")
    .select("user_id")
    .eq("line_sub", lineSub)
    .maybeSingle();
  if (identErr) return NextResponse.json({ error: identErr.message }, { status: 500 });

  const userId = ident?.user_id as string | undefined;
  if (!userId) return NextResponse.json({ error: "user not linked. please login again." }, { status: 401 });

  // เช็คฝั่ง server ว่า booking นี้เป็นของ user คนนี้จริง และยืนยันแล้วเท่านั้นถึงรีวิวได้
  const { data: bookingRaw, error: bookingErr } = await supabaseAdmin
    .from("bookings")
    .select("id, user_id, status, concert_sessions:session_id ( concerts:concert_id ( title ) )")
    .eq("id", bookingId)
    .maybeSingle();
  if (bookingErr) return NextResponse.json({ error: bookingErr.message }, { status: 500 });

  const booking = bookingRaw as unknown as BookingForReview | null;
  if (!booking || booking.user_id !== userId) {
    return NextResponse.json({ error: "booking not found" }, { status: 404 });
  }
  if (booking.status !== "confirmed") {
    return NextResponse.json({ error: "booking not confirmed" }, { status: 400 });
  }

  const concertTitle = booking.concert_sessions?.concerts?.title ?? null;

  const { error: insertErr } = await supabaseAdmin.from("reviews").insert({
    user_id: userId,
    booking_id: bookingId,
    concert_title: concertTitle,
    display_name: displayName,
    rating,
    comment,
  });

  if (insertErr) {
    if (insertErr.code === "23505") {
      return NextResponse.json({ error: "already_reviewed" }, { status: 409 });
    }
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
