import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyPassword } from "@/lib/adminPassword";
import { logAdminAction } from "@/lib/adminAudit";
import { signJWT } from "@/lib/adminAuth";

const MAX_FAILURES = 5;        // จำนวนครั้งที่ผิดได้ก่อนโดนล็อก
const WINDOW_MINUTES = 15;     // นับความผิดย้อนหลังกี่นาที
const LOCKOUT_MINUTES = 15;    // ล็อกนานแค่ไหนหลังผิดครบจำนวน
const PENDING_2FA_MINUTES = 5; // token ชั่วคราวระหว่างรอกรอกรหัส 2FA อยู่ได้กี่นาที

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

  let body: { username?: string; password?: string } | null = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const username = String(body?.username ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");

  // 1) เช็คว่าโดนล็อกอยู่ไหม — เช็คทั้งสองทาง: ตาม IP (กันยิงรัวจากเครื่องเดียว) และ
  // ตาม username (กันเดารหัสบัญชีเดียวกันแบบกระจายยิงจากหลาย IP/บอตเน็ต) โดนอันไหนก่อนก็ล็อกอันนั้น
  const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();

  const { data: recentAttempts, error: attErr } = await supabase
    .from("admin_login_attempts")
    .select("success, created_at")
    .eq("ip", ip)
    .gte("created_at", windowStart)
    .order("created_at", { ascending: false });
  const failuresInWindow = !attErr && recentAttempts ? recentAttempts.filter((a) => !a.success) : [];

  let failuresByUsername: typeof recentAttempts = [];
  if (username) {
    const { data: userAttempts, error: userAttErr } = await supabase
      .from("admin_login_attempts")
      .select("success, created_at")
      .eq("username", username)
      .gte("created_at", windowStart)
      .order("created_at", { ascending: false });
    failuresByUsername = !userAttErr && userAttempts ? userAttempts.filter((a) => !a.success) : [];
  }

  const checkLockout = (failures: typeof recentAttempts) => {
    if (!failures || failures.length < MAX_FAILURES) return null;
    const mostRecentFailure = new Date(failures[0].created_at).getTime();
    const lockoutEndsAt = mostRecentFailure + LOCKOUT_MINUTES * 60 * 1000;
    if (Date.now() >= lockoutEndsAt) return null;
    return Math.ceil((lockoutEndsAt - Date.now()) / 60000);
  };

  const ipWaitMin = checkLockout(failuresInWindow);
  const userWaitMin = checkLockout(failuresByUsername);
  const waitMin = ipWaitMin != null || userWaitMin != null ? Math.max(ipWaitMin ?? 0, userWaitMin ?? 0) : null;

  if (waitMin != null) {
    return NextResponse.json(
      { error: `พยายามผิดเกินกำหนด กรุณารออีก ${waitMin} นาทีแล้วลองใหม่` },
      { status: 429 }
    );
  }

  let isCorrect = false;
  let adminId: string | null = null;
  let totpEnabled = false;
  let pwdVer: number | null = null;

  if (username && password) {
    const { data: account } = await supabase
      .from("admin_users")
      .select("id, password_hash, totp_enabled, password_changed_at")
      .eq("username", username)
      .maybeSingle();

    if (account && verifyPassword(password, account.password_hash)) {
      isCorrect = true;
      adminId = account.id;
      totpEnabled = Boolean(account.totp_enabled);
      pwdVer = account.password_changed_at ? new Date(account.password_changed_at).getTime() : null;
    }
  }

  // 2) log ความพยายามนี้ไว้เสมอ (ทั้งผ่านและไม่ผ่าน) เพื่อคำนวณ lockout ครั้งถัดไป
  await supabase.from("admin_login_attempts").insert({ ip, username: username || null, success: isCorrect });

  if (!isCorrect || !adminId) {
    // เอาฝั่งที่ใกล้โดนล็อกกว่า (เหลือน้อยกว่า) มาโชว์ เพราะทั้งสองทางนับ +1 ครั้งนี้ด้วยเหมือนกัน
    const totalFailuresByIp = failuresInWindow.length + 1;
    const totalFailuresByUser = (failuresByUsername?.length ?? 0) + (username ? 1 : 0);
    const remaining = Math.max(
      0,
      MAX_FAILURES - Math.max(totalFailuresByIp, totalFailuresByUser)
    );
    const message =
      remaining === 0
        ? `พยายามผิดครบ ${MAX_FAILURES} ครั้งแล้ว บัญชีถูกล็อกชั่วคราว ${LOCKOUT_MINUTES} นาที`
        : `ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง (เหลืออีก ${remaining} ครั้ง ก่อนถูกล็อกชั่วคราว)`;
    return NextResponse.json({ error: message, remaining }, { status: 401 });
  }

  // บัญชีนี้เปิด 2FA ไว้ — ยังไม่ออก session จริง ให้ token ชั่วคราวไปกรอกรหัส 6 หลักต่อก่อน
  if (totpEnabled) {
    const pendingToken = signJWT(
      {
        role: "admin_2fa_pending",
        admin_id: adminId,
        username,
        // ผูกเวอร์ชันรหัสผ่านไว้ด้วย เพื่อให้ token ที่ค้างรอกรอก 2FA ถูกเพิกถอน
        // ทันทีที่มีการเปลี่ยนรหัสผ่าน (เดิมยังใช้ออก session ใหม่ได้จนครบ 5 นาที)
        pwd_ver: pwdVer,
        exp: Math.floor(Date.now() / 1000) + PENDING_2FA_MINUTES * 60,
      },
      sessionSecret
    );
    return NextResponse.json({ ok: true, needs2fa: true, pending_token: pendingToken });
  }

  const token = signJWT(
    { role: "admin", admin_id: adminId, username, pwd_ver: pwdVer, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12 },
    sessionSecret
  );

  await logAdminAction({ username, action: "เข้าสู่ระบบ", detail: `เข้าสู่ระบบจาก IP ${ip}` });

  const res = NextResponse.json({ ok: true, needs2fa: false, username });
  res.cookies.set("admin_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return res;
}
