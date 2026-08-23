import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { findOrCreateLineUser, signSessionJWT } from "@/lib/lineSession";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export async function GET(req: NextRequest) {
  const baseUrl = process.env.APP_BASE_URL || "http://localhost:3000";

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(`${baseUrl}/login?error=${encodeURIComponent(error)}`);
  }
  if (!code || !state) {
    return NextResponse.redirect(`${baseUrl}/login?error=missing_code_or_state`);
  }

  // 1) ตรวจ state/nonce จาก cookie (กัน CSRF)
  const expectedState = req.cookies.get("line_oauth_state")?.value;
  const expectedNonce = req.cookies.get("line_oauth_nonce")?.value;

  if (!expectedState || state !== expectedState) {
    return NextResponse.redirect(`${baseUrl}/login?error=invalid_state`);
  }

  const clientId = getEnv("LINE_CHANNEL_ID");
  const clientSecret = getEnv("LINE_CHANNEL_SECRET");
  const redirectUri = getEnv("LINE_REDIRECT_URI");
  const appSessionSecret = getEnv("APP_SESSION_SECRET");

  // ✅ Supabase admin (service role) สำหรับสร้าง/ผูก user
  const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  // 2) แลก code -> token
  const tokenRes = await fetch("https://api.line.me/oauth2/v2.1/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    return NextResponse.redirect(
      `${baseUrl}/login?error=token_exchange_failed&detail=${encodeURIComponent(text)}`
    );
  }

  const tokenJson = (await tokenRes.json()) as {
    access_token: string;
    id_token?: string;
    expires_in?: number;
    token_type?: string;
    scope?: string;
    refresh_token?: string;
  };

  const idToken = tokenJson.id_token;
  if (!idToken) {
    return NextResponse.redirect(`${baseUrl}/login?error=missing_id_token`);
  }

  // 3) Verify ID token ด้วย endpoint ของ LINE
  const verifyRes = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      id_token: idToken,
      client_id: clientId,
    }),
  });

  if (!verifyRes.ok) {
    const text = await verifyRes.text();
    return NextResponse.redirect(
      `${baseUrl}/login?error=id_token_verify_failed&detail=${encodeURIComponent(text)}`
    );
  }

  const verified = (await verifyRes.json()) as {
    sub: string; // LINE user id
    name?: string;
    picture?: string;
    nonce?: string;
    iss?: string;
    aud?: string;
    exp?: number;
    iat?: number;
  };

  if (!verified.sub) {
    return NextResponse.redirect(`${baseUrl}/login?error=missing_sub`);
  }

  // nonce check — บังคับว่าต้องมี nonce cookie ของเราเองอยู่ด้วยเสมอ (route /login ตั้งไว้คู่กับ state
  // ทุกครั้ง) ไม่ใช่แค่เช็คว่าตรงกันตอนที่ทั้งสองค่ามีอยู่ เพราะถ้า cookie หายไปเฉยๆ (หรือ LINE ไม่ส่ง
  // nonce กลับมาทั้งที่เราคาดหวังไว้) ควรถือว่าน่าสงสัยแล้วปฏิเสธไปเลย ไม่ใช่ปล่อยผ่าน
  if (!expectedNonce || verified.nonce !== expectedNonce) {
    return NextResponse.redirect(`${baseUrl}/login?error=invalid_nonce`);
  }

  const lineSub = verified.sub;
  const displayName = verified.name ?? null;
  const picture = verified.picture ?? null;

  // 4) ✅ หา/สร้าง Supabase auth user + upsert profiles — ใช้ helper ตัวเดียวกับ LIFF login
  //    (มี race-recovery ในตัว กันกรณี OAuth กับ LIFF login พร้อมกันแล้วชนกัน)
  const linkedUser = await findOrCreateLineUser(supabaseAdmin, lineSub, displayName, picture);
  if ("error" in linkedUser) {
    return NextResponse.redirect(
      `${baseUrl}/login?error=find_or_create_user_failed&detail=${encodeURIComponent(linkedUser.error)}`
    );
  }
  const userId = linkedUser.userId;

  // 5.5) ❌ เช็คว่าบัญชีนี้ถูกแบนหรือไม่ ก่อนออก session ใหม่
  const { data: banCheck } = await supabaseAdmin
    .from("profiles")
    .select("is_banned")
    .eq("id", userId)
    .maybeSingle();

  if (banCheck?.is_banned) {
    return NextResponse.redirect(`${baseUrl}/login?error=banned`);
  }

  // 6) ออก session cookie ของเราเอง (เหมือนเดิม)
  const sessionJwt = signSessionJWT(
    {
      line_sub: lineSub,
      name: displayName,
      picture,
      app_user_id: userId, // ✅ ใส่ userId ไปใน JWT ของคุณด้วย (สะดวก debug)
    },
    appSessionSecret,
    60 * 60 * 24 * 7 // 7 วัน
  );

  const res = NextResponse.redirect(`${baseUrl}/`);

  // เคลียร์ cookie ชั่วคราว state/nonce
  res.cookies.set("line_oauth_state", "", { path: "/", maxAge: 0 });
  res.cookies.set("line_oauth_nonce", "", { path: "/", maxAge: 0 });

  // ตั้ง cookie session ของคุณ
  res.cookies.set("app_session", sessionJwt, {
    httpOnly: true,
    sameSite: "lax",
    secure: baseUrl.startsWith("https"),
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  // ✅ ตั้ง cookie user id มาตรฐานสำหรับผูก bookings.user_id
  res.cookies.set("app_user_id", userId, {
    httpOnly: true,
    sameSite: "lax",
    secure: baseUrl.startsWith("https"),
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 วัน
  });

  // (ถ้าคุณอยากเก็บ line_sub แยกไว้ด้วยก็ได้)
  res.cookies.set("line_sub", lineSub, {
    httpOnly: true,
    sameSite: "lax",
    secure: baseUrl.startsWith("https"),
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return res;
}