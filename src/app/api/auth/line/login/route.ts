import { NextResponse } from "next/server";
import crypto from "crypto";

function base64url(buf: Buffer) {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function randomString(bytes = 32) {
  return base64url(crypto.randomBytes(bytes));
}

export async function GET() {
  const clientId = process.env.LINE_CHANNEL_ID;
  const redirectUri = process.env.LINE_REDIRECT_URI;
  const baseUrl = process.env.APP_BASE_URL || "http://localhost:3000";

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: "Missing LINE_CHANNEL_ID or LINE_REDIRECT_URI" },
      { status: 500 }
    );
  }

  const state = randomString(24);
  const nonce = randomString(24);

  const authorizeUrl = new URL("https://access.line.me/oauth2/v2.1/authorize");
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("scope", "openid profile"); // ไม่ใช้ email ตามที่คุณบอก
  authorizeUrl.searchParams.set("nonce", nonce);

  const res = NextResponse.redirect(authorizeUrl.toString());

  const cookieOptions = {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: baseUrl.startsWith("https"),
    path: "/",
    maxAge: 60 * 10, // 10 นาที
  };

  res.cookies.set("line_oauth_state", state, cookieOptions);
  res.cookies.set("line_oauth_nonce", nonce, cookieOptions);

  return res;
}