import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { signSessionJWT, findOrCreateLineUser } from "@/lib/lineSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

// POST /api/auth/liff/verify — รับ ID token จาก liff.getIDToken() ฝั่ง client
// verify กับ LINE เอง (ห้ามเชื่อ profile จาก client ตรงๆ) แล้วออก session cookie เดียวกับ OAuth flow เดิม
export async function POST(req: NextRequest) {
  try {
    const baseUrl = process.env.APP_BASE_URL || "http://localhost:3000";
    const body = await req.json().catch(() => null);
    const idToken = (body as { idToken?: string } | null)?.idToken;

    if (!idToken) {
      return NextResponse.json({ error: "missing idToken" }, { status: 400 });
    }

    const clientId = getEnv("LINE_CHANNEL_ID");
    const appSessionSecret = getEnv("APP_SESSION_SECRET");
    const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // 1) verify ID token กับ LINE เอง — ห้ามเชื่อค่าจาก client ตรงๆ
    const verifyRes = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: idToken, client_id: clientId }),
    });

    if (!verifyRes.ok) {
      const text = await verifyRes.text();
      return NextResponse.json({ error: "id_token_verify_failed", detail: text }, { status: 401 });
    }

    const verified = (await verifyRes.json()) as {
      sub: string;
      name?: string;
      picture?: string;
      exp?: number;
    };

    if (!verified.sub) {
      return NextResponse.json({ error: "missing_sub" }, { status: 401 });
    }

    const lineSub = verified.sub;
    const displayName = verified.name ?? null;
    const picture = verified.picture ?? null;

    // 2) หา/สร้าง user เดียวกับ flow OAuth (ใช้ user_id เดิมถ้าเคย login ผ่าน OAuth มาก่อน)
    const result = await findOrCreateLineUser(supabaseAdmin, lineSub, displayName, picture);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    const userId = result.userId;

    // 3) ออก session cookie เดียวกับ OAuth flow เดิมทุกอย่าง
    const sessionJwt = signSessionJWT(
      { line_sub: lineSub, name: displayName, picture, app_user_id: userId },
      appSessionSecret,
      60 * 60 * 24 * 7 // 7 วัน
    );

    const res = NextResponse.json({ ok: true });
    const isProd = baseUrl.startsWith("https");

    res.cookies.set("app_session", sessionJwt, {
      httpOnly: true, sameSite: "lax", secure: isProd, path: "/", maxAge: 60 * 60 * 24 * 7,
    });
    res.cookies.set("app_user_id", userId, {
      httpOnly: true, sameSite: "lax", secure: isProd, path: "/", maxAge: 60 * 60 * 24 * 30,
    });
    res.cookies.set("line_sub", lineSub, {
      httpOnly: true, sameSite: "lax", secure: isProd, path: "/", maxAge: 60 * 60 * 24 * 30,
    });

    return res;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "server_error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
