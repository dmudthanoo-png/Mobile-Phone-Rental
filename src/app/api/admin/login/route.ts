import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { verifyPassword } from "@/lib/adminPassword";
import { logAdminAction } from "@/lib/adminAudit";

const MAX_FAILURES = 5;        // จำนวนครั้งที่ผิดได้ก่อนโดนล็อก
const WINDOW_MINUTES = 15;     // นับความผิดย้อนหลังกี่นาที
const LOCKOUT_MINUTES = 15;    // ล็อกนานแค่ไหนหลังผิดครบจำนวน

function signAdminJWT(secret: string, adminId: string, username: string) {
  const header = { alg: "HS256", typ: "JWT" };
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 12; // 12 ชม.
  const payload = { role: "admin", admin_id: adminId, username, exp };

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

function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

export async function POST(req: NextRequest) {
  const sessionSecret = process.env.APP_SESSION_SECRET;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!sessionSecret || !supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "missing env" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const ip = getClientIp(req);

  // 1) เช็คว่าโดนล็อกอยู่ไหม (ผิดครบจำนวนภายในช่วงเวลาที่กำหนด) — นับตาม IP
  const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();
  const { data: recentAttempts, error: attErr } = await supabase
    .from("admin_login_attempts")
    .select("success, created_at")
    .eq("ip", ip)
    .gte("created_at", windowStart)
    .order("created_at", { ascending: false });

  const failuresInWindow = !attErr && recentAttempts ? recentAttempts.filter((a) => !a.success) : [];

  if (failuresInWindow.length >= MAX_FAILURES) {
    const mostRecentFailure = new Date(failuresInWindow[0].created_at).getTime();
    const lockoutEndsAt = mostRecentFailure + LOCKOUT_MINUTES * 60 * 1000;
    if (Date.now() < lockoutEndsAt) {
      const waitMin = Math.ceil((lockoutEndsAt - Date.now()) / 60000);
      return NextResponse.json(
        { error: `พยายามผิดเกินกำหนด กรุณารออีก ${waitMin} นาทีแล้วลองใหม่` },
        { status: 429 }
      );
    }
  }

  let body: { username?: string; password?: string } | null = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const username = String(body?.username ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");

  let isCorrect = false;
  let adminId: string | null = null;

  if (username && password) {
    const { data: account } = await supabase
      .from("admin_users")
      .select("id, password_hash")
      .eq("username", username)
      .maybeSingle();

    if (account && verifyPassword(password, account.password_hash)) {
      isCorrect = true;
      adminId = account.id;
    }
  }

  // 2) log ความพยายามนี้ไว้เสมอ (ทั้งผ่านและไม่ผ่าน) เพื่อคำนวณ lockout ครั้งถัดไป
  await supabase.from("admin_login_attempts").insert({ ip, username: username || null, success: isCorrect });

  if (!isCorrect || !adminId) {
    const totalFailures = failuresInWindow.length + 1;
    const remaining = Math.max(0, MAX_FAILURES - totalFailures);
    const message =
      remaining === 0
        ? `พยายามผิดครบ ${MAX_FAILURES} ครั้งแล้ว บัญชีถูกล็อกชั่วคราว ${LOCKOUT_MINUTES} นาที`
        : `ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง (เหลืออีก ${remaining} ครั้ง ก่อนถูกล็อกชั่วคราว)`;
    return NextResponse.json({ error: message, remaining }, { status: 401 });
  }

  const token = signAdminJWT(sessionSecret, adminId, username);

  await logAdminAction({ username, action: "login", detail: `เข้าสู่ระบบจาก IP ${ip}` });

  const res = NextResponse.json({ ok: true, username });
  res.cookies.set("admin_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return res;
}
