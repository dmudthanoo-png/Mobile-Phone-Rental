import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

function signAdminJWT(secret: string) {
  const header = { alg: "HS256", typ: "JWT" };
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 12; // 12 ชม.
  const payload = { role: "admin", exp };

  const b64u = (obj: any) =>
    Buffer.from(JSON.stringify(obj))
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

  const h = b64u(header);
  const p = b64u(payload);
  const data = `${h}.${p}`;

  const sig = crypto
    .createHmac("sha256", secret)
    .update(data)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${data}.${sig}`;
}

export async function POST(req: NextRequest) {
  const adminPassword = process.env.ADMIN_PASSWORD;
  const sessionSecret = process.env.APP_SESSION_SECRET; // ใช้อันเดียวกับ app_session ได้เลย

  if (!adminPassword || !sessionSecret) {
    return NextResponse.json({ error: "missing env (ADMIN_PASSWORD / APP_SESSION_SECRET)" }, { status: 500 });
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const password = String(body?.password ?? "");
  if (!password || password !== adminPassword) {
    return NextResponse.json({ error: "invalid password" }, { status: 401 });
  }

  const token = signAdminJWT(sessionSecret);

  const res = NextResponse.json({ ok: true });
  res.cookies.set("admin_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return res;
}