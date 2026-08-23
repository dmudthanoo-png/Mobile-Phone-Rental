import crypto from "crypto";
import type { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

function base64urlToBuffer(b64url: string) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64url.length + 3) % 4);
  return Buffer.from(b64, "base64");
}

export function signJWT(payload: Record<string, unknown>, secret: string): string {
  const header = { alg: "HS256", typ: "JWT" };

  const b64u = (obj: Record<string, unknown>) =>
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

  const payload = JSON.parse(payloadJson) as {
    exp?: number;
    role?: string;
    admin_id?: string;
    username?: string;
    [k: string]: unknown;
  };
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now > payload.exp) return null;
  return payload;
}

// เช็คว่าบัญชีแอดมินนี้ยังมีอยู่จริงในระบบทุกครั้ง (ไม่ใช่แค่ verify ลายเซ็น JWT)
// เพื่อให้การ "ลบบัญชีแอดมิน" มีผลทันที ไม่ต้องรอ session เดิมหมดอายุเอง (สูงสุด 12 ชม.)
export async function requireAdmin(req: NextRequest) {
  const secret = process.env.APP_SESSION_SECRET;
  if (!secret) return { ok: false as const, error: "missing APP_SESSION_SECRET" };

  const token = req.cookies.get("admin_session")?.value;
  if (!token) return { ok: false as const, error: "unauthorized" };

  const payload = verifyJWT(token, secret);
  if (!payload || payload.role !== "admin") return { ok: false as const, error: "unauthorized" };

  const adminId = payload.admin_id;
  if (!adminId) return { ok: false as const, error: "unauthorized" };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return { ok: false as const, error: "missing supabase env" };

  const supabase = createClient(url, serviceKey);
  const { data } = await supabase
    .from("admin_users")
    .select("id, password_changed_at")
    .eq("id", adminId)
    .maybeSingle();
  if (!data) return { ok: false as const, error: "unauthorized" };

  // เช็คว่า token นี้ถูกออกหลังการเปลี่ยนรหัสผ่านล่าสุดไหม — ถ้าเปลี่ยนรหัสผ่านไปแล้ว
  // token เก่า (เช่น เครื่องอื่น/ถูกขโมยไป) ที่ pwd_ver ไม่ตรงกับเวลาปัจจุบันในฐานข้อมูล จะถูกตัดสิทธิ์ทันที
  const currentPwdVer = data.password_changed_at ? new Date(data.password_changed_at).getTime() : null;
  if (currentPwdVer !== null && payload.pwd_ver !== currentPwdVer) {
    return { ok: false as const, error: "session หมดอายุ (มีการเปลี่ยนรหัสผ่าน) กรุณาเข้าสู่ระบบใหม่" };
  }

  return { ok: true as const, payload };
}