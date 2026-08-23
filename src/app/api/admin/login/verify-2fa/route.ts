import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { signJWT, verifyJWT } from "@/lib/adminAuth";
import { verifyTotpCode } from "@/lib/totp";
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

  if (!sessionSecret || !supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "missing env" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const ip = getClientIp(req);

  // เช็คล็อกด้วย IP เดียวกับ login ปกติ กันการยิงเดารหัส 6 หลักรัวๆ
  const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();
  const { data: recentAttempts } = await supabase
    .from("admin_login_attempts")
    .select("success, created_at")
    .eq("ip", ip)
    .gte("created_at", windowStart)
    .order("created_at", { ascending: false });

  const failuresInWindow = recentAttempts ? recentAttempts.filter((a) => !a.success) : [];

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

  const body = await req.json().catch(() => null);
  const pendingToken = String((body as { pending_token?: string } | null)?.pending_token ?? "");
  const code = String((body as { code?: string } | null)?.code ?? "");

  const pendingPayload = pendingToken ? verifyJWT(pendingToken, sessionSecret) : null;
  if (!pendingPayload || pendingPayload.role !== "admin_2fa_pending" || !pendingPayload.admin_id) {
    return NextResponse.json({ error: "session หมดอายุ กรุณาเข้าสู่ระบบใหม่" }, { status: 401 });
  }

  const adminId = String(pendingPayload.admin_id);
  const username = String(pendingPayload.username ?? "");

  const { data: account } = await supabase
    .from("admin_users")
    .select("totp_secret, totp_enabled")
    .eq("id", adminId)
    .maybeSingle();

  const isCorrect = Boolean(
    account?.totp_enabled && account.totp_secret && verifyTotpCode(account.totp_secret, code)
  );

  await supabase.from("admin_login_attempts").insert({ ip, username: username || null, success: isCorrect });

  if (!isCorrect) {
    const totalFailures = failuresInWindow.length + 1;
    const remaining = Math.max(0, MAX_FAILURES - totalFailures);
    const message =
      remaining === 0
        ? `พยายามผิดครบ ${MAX_FAILURES} ครั้งแล้ว บัญชีถูกล็อกชั่วคราว ${LOCKOUT_MINUTES} นาที`
        : `รหัส 2FA ไม่ถูกต้อง (เหลืออีก ${remaining} ครั้ง ก่อนถูกล็อกชั่วคราว)`;
    return NextResponse.json({ error: message, remaining }, { status: 401 });
  }

  const token = signJWT(
    { role: "admin", admin_id: adminId, username, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12 },
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
