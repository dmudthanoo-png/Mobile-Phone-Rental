import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { createSignedSlipUrl } from "@/lib/slipStorage";

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

// GET /api/bookings/[id]/slip-url — ลูกค้าดูสลิปของ "การจองตัวเอง" เท่านั้น
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id?: string }> }
) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const sessionSecret = process.env.APP_SESSION_SECRET;
  if (!url || !serviceKey || !sessionSecret) {
    return NextResponse.json({ error: "missing env" }, { status: 500 });
  }

  const { id } = await ctx.params;
  if (!id || !uuidRe.test(id)) {
    return NextResponse.json({ error: `invalid booking id: ${id}` }, { status: 400 });
  }

  const token = req.cookies.get("app_session")?.value;
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const payload = verifySessionJWT(token, sessionSecret);
  const lineSub = payload?.line_sub as string | undefined;
  if (!lineSub) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const supabase = createClient(url, serviceKey);

  let userId = payload?.app_user_id as string | undefined;
  if (!userId) {
    const { data: ident } = await supabase
      .from("line_identities")
      .select("user_id")
      .eq("line_sub", lineSub)
      .maybeSingle();
    userId = ident?.user_id ?? undefined;
  }
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: booking, error } = await supabase
    .from("bookings")
    .select("slip_url, user_id")
    .eq("id", id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!booking || booking.user_id !== userId) {
    return NextResponse.json({ error: "ไม่พบการจองนี้" }, { status: 404 });
  }
  if (!booking.slip_url) return NextResponse.json({ error: "ไม่มีสลิป" }, { status: 404 });

  const signedUrl = await createSignedSlipUrl(booking.slip_url);
  if (!signedUrl) return NextResponse.json({ error: "สร้างลิงก์ดูสลิปไม่สำเร็จ" }, { status: 500 });

  return NextResponse.json({ url: signedUrl });
}
