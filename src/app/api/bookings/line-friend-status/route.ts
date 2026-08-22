import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { checkLineFriendshipStatus } from "@/lib/lineMessaging";

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

// GET /api/bookings/line-friend-status — ลูกค้าเช็คเองว่าเพิ่มเพื่อน LINE OA แล้วหรือยัง
// ก่อนแอดมินอนุมัติ เพื่อให้มั่นใจว่าจะได้รับการแจ้งเตือนตอนอนุมัติจริง
export async function GET(req: NextRequest) {
  const secret = process.env.APP_SESSION_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "missing_app_session_secret" }, { status: 500 });
  }

  const token = req.cookies.get("app_session")?.value;
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const payload = verifySessionJWT(token, secret);
  const lineSub = typeof payload?.line_sub === "string" ? payload.line_sub : null;
  if (!lineSub) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await checkLineFriendshipStatus(lineSub);
  if (!result.ok) {
    return NextResponse.json({ isFriend: null, reason: result.reason }, { status: 200 });
  }

  return NextResponse.json({ isFriend: result.isFriend }, { status: 200 });
}
