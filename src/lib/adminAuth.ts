import crypto from "crypto";
import type { NextRequest } from "next/server";

function base64urlToBuffer(b64url: string) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64url.length + 3) % 4);
  return Buffer.from(b64, "base64");
}

export function verifyJWT(token: string, secret: string) {
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

  const payload = JSON.parse(payloadJson) as { exp?: number; role?: string; [k: string]: any };
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now > payload.exp) return null;
  return payload;
}

export function requireAdmin(req: NextRequest) {
  const secret = process.env.APP_SESSION_SECRET;
  if (!secret) return { ok: false as const, error: "missing APP_SESSION_SECRET" };

  const token = req.cookies.get("admin_session")?.value;
  if (!token) return { ok: false as const, error: "unauthorized" };

  const payload = verifyJWT(token, secret);
  if (!payload || payload.role !== "admin") return { ok: false as const, error: "unauthorized" };

  return { ok: true as const, payload };
}