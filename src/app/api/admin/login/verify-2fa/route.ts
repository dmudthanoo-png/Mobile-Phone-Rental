import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { signJWT, verifyJWT } from "@/lib/adminAuth";
import { verifyTotpCode, safeDecryptTotpSecret, encryptTotpSecret, isLegacyPlaintextTotpSecret } from "@/lib/totp";
import { logAdminAction } from "@/lib/adminAudit";

const MAX_FAILURES = 5;
const WINDOW_MINUTES = 15;
const LOCKOUT_MINUTES = 15;

function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

// POST /api/admin/login/verify-2fa — ขั้นตอนที่ 2 ของ login เมื่อบัญชีเปิด 2FA ไว้
// body: { pending_token, code }
export async function POST(req: NextRequest) {
  const sessionSecret = process.env.APP_SESSION_SECRET;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!sessionSecret || !supabaseUrl || !serviceKey || !process.env.TOTP_ENCRYPTION_KEY) {
    return NextResponse.json({ error: "missing env" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const ip = getClientIp(req);

  const body = await req.json().catch(() => null);
  const pendingToken = String((body as { pending_token?: string } | null)?.pending_token ?? "");
  const code = String((body as { code?: string } | null)?.code ?? "");

  const pendingPayload = pendingToken ? verifyJWT(pendingToken, sessionSecret) : null;
  if (!pendingPayload || pendingPayload.role !== "admin_2fa_pending" || !pendingPayload.admin_id) {
    return NextResponse.json({ error: "session หมดอายุ กรุณาเข้าสู่ระบบใหม่" }, { status: 401 });
  }

  const adminId = String(pendingPayload.admin_id);
  const username = String(pendingPayload.username ?? "");

  // เช็คล็อกทั้งตาม IP และตาม username (บัญชีเดียวกัน) เหมือน login ขั้นแรก
  const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();

  const { data: recentAttempts } = await supabase
    .from("admin_login_attempts")
    .select("success, created_at")
    .eq("ip", ip)
    .gte("created_at", windowStart)
    .order("created_at", { ascending: false });
  const failuresInWindow = recentAttempts ? recentAttempts.filter((a) => !a.success) : [];

  const { data: userAttempts } = await supabase
    .from("admin_login_attempts")
    .select("success, created_at")
    .eq("username", username)
    .gte("created_at", windowStart)
    .order("created_at", { ascending: false });
  const failuresByUsername = userAttempts ? userAttempts.filter((a) => !a.success) : [];

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

  const { data: account } = await supabase
    .from("admin_users")
    .select("totp_secret, totp_enabled, password_changed_at")
    .eq("id", adminId)
    .maybeSingle();

  const wasLegacyPlaintext = Boolean(account?.totp_secret && isLegacyPlaintextTotpSecret(account.totp_secret));
  const plainSecret = account?.totp_secret ? safeDecryptTotpSecret(account.totp_secret) : "";
  if (account?.totp_secret && plainSecret === null) {
    return NextResponse.json(
      { error: "อ่านค่า 2FA ไม่ได้ (encryption key อาจไม่ถูกต้องหรือข้อมูลเสียหาย) กรุณาติดต่อผู้ดูแลระบบ" },
      { status: 500 }
    );
  }
  const isCorrect = Boolean(account?.totp_enabled && plainSecret && verifyTotpCode(plainSecret, code));

  await supabase.from("admin_login_attempts").insert({ ip, username: username || null, success: isCorrect });

  // secret เก่ายังเป็น plaintext อยู่ — verify ผ่านแล้วเข้ารหัสทับให้ทันที (self-heal แบบ lazy migration)
  // ผูก .eq("totp_secret", ...) ไว้เป็น optimistic lock กัน race กับ /2fa/disable ที่อาจปิด 2FA
  // (ตั้ง secret เป็น null) พร้อมกันพอดี ไม่ให้ write นี้ไปชุบชีวิต secret เก่าคืนหลังโดนปิดไปแล้ว
  if (isCorrect && wasLegacyPlaintext && plainSecret) {
    await supabase
      .from("admin_users")
      .update({ totp_secret: encryptTotpSecret(plainSecret) })
      .eq("id", adminId)
      .eq("totp_secret", account!.totp_secret);
  }

  if (!isCorrect) {
    const totalFailuresByIp = failuresInWindow.length + 1;
    const totalFailuresByUser = failuresByUsername.length + (username ? 1 : 0);
    const remaining = Math.max(
      0,
      MAX_FAILURES - Math.max(totalFailuresByIp, totalFailuresByUser)
    );
    const message =
      remaining === 0
        ? `พยายามผิดครบ ${MAX_FAILURES} ครั้งแล้ว บัญชีถูกล็อกชั่วคราว ${LOCKOUT_MINUTES} นาที`
        : `รหัส 2FA ไม่ถูกต้อง (เหลืออีก ${remaining} ครั้ง ก่อนถูกล็อกชั่วคราว)`;
    return NextResponse.json({ error: message, remaining }, { status: 401 });
  }

  const pwdVer = account?.password_changed_at ? new Date(account.password_changed_at).getTime() : null;
  const token = signJWT(
    { role: "admin", admin_id: adminId, username, pwd_ver: pwdVer, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12 },
    sessionSecret
  );

  await logAdminAction({ username, action: "เข้าสู่ระบบ", detail: `เข้าสู่ระบบจาก IP ${ip} (ยืนยัน 2FA แล้ว)` });

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
