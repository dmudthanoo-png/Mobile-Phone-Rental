import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function base64url(input: Buffer | string) {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

// สร้าง JWT แบบ HS256 ง่าย ๆ (session ของเราเอง)
function signSessionJWT(payload: Record<string, any>, secret: string, expiresInSec: number) {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);

  const fullPayload = { ...payload, iat: now, exp: now + expiresInSec };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(fullPayload));
  const data = `${encodedHeader}.${encodedPayload}`;

  const sig = crypto.createHmac("sha256", secret).update(data).digest();
  const encodedSig = base64url(sig);

  return `${data}.${encodedSig}`;
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

  // nonce check (ถ้ามี)
  if (expectedNonce && verified.nonce && verified.nonce !== expectedNonce) {
    return NextResponse.redirect(`${baseUrl}/login?error=invalid_nonce`);
  }

  const lineSub = verified.sub;
  const displayName = verified.name ?? null;
  const picture = verified.picture ?? null;

  // 4) ✅ หา/สร้าง Supabase auth user โดยอ้างจาก line_identities
  //    (ต้องมีตาราง public.line_identities(line_sub pk, user_id uuid fk auth.users))
  let userId: string | null = null;

  const { data: ident, error: identErr } = await supabaseAdmin
    .from("line_identities")
    .select("user_id")
    .eq("line_sub", lineSub)
    .maybeSingle();

  if (identErr) {
    return NextResponse.redirect(
      `${baseUrl}/login?error=line_identity_lookup_failed&detail=${encodeURIComponent(identErr.message)}`
    );
  }

  if (ident?.user_id) userId = ident.user_id;

  if (!userId) {
    // สร้าง user ใหม่ใน auth.users
    // Supabase createUser ต้องมี email -> ใช้ placeholder โดเมน .invalid (ไม่ส่งเมลจริง)
    const email = `line_${lineSub}@example.invalid`;

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { provider: "line", line_sub: lineSub, name: displayName, picture },
    });

    if (createErr || !created?.user?.id) {
      return NextResponse.redirect(
        `${baseUrl}/login?error=supabase_create_user_failed&detail=${encodeURIComponent(
          createErr?.message || "no_user_returned"
        )}`
      );
    }

    userId = created.user.id;

    // insert mapping
    const { error: mapErr } = await supabaseAdmin
      .from("line_identities")
      .insert({ line_sub: lineSub, user_id: userId });

    if (mapErr) {
      return NextResponse.redirect(
        `${baseUrl}/login?error=line_identity_insert_failed&detail=${encodeURIComponent(mapErr.message)}`
      );
    }
  }

  // 5) ✅ upsert profiles (id = auth.users.id)
  const { error: profErr } = await supabaseAdmin
    .from("profiles")
    .upsert(
      {
        id: userId,
        line_sub: lineSub,
        name: displayName,
        picture,
      },
      { onConflict: "id" }
    );

  if (profErr) {
    return NextResponse.redirect(
      `${baseUrl}/login?error=profile_upsert_failed&detail=${encodeURIComponent(profErr.message)}`
    );
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