import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { findOrCreateLineUser } from "@/lib/lineSession";
import { PRIVACY_NOTICE_VERSION } from "@/lib/privacyNotice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function base64urlToBuffer(b64url: string) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64url.length + 3) % 4);
  return Buffer.from(b64, "base64");
}

function verifySessionJWT(token: string, secret: string) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const h = parts[0];
  const p = parts[1];
  const s = parts[2];
  const data = h + "." + p;
  const expected = crypto.createHmac("sha256", secret).update(data).digest();
  const given = base64urlToBuffer(s);

  if (expected.length !== given.length) return null;
  if (!crypto.timingSafeEqual(expected, given)) return null;

  const payloadJson = Buffer.from(
    p.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((p.length + 3) % 4),
    "base64"
  ).toString("utf8");

  const payload = JSON.parse(payloadJson) as { exp?: number; [key: string]: unknown };
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now > payload.exp) return null;
  return payload;
}

// Records acknowledgement of the current notice version. This is not marketing consent.
export async function POST(req: NextRequest) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const sessionSecret = process.env.APP_SESSION_SECRET;
    if (!url || !serviceKey || !sessionSecret) {
      return NextResponse.json({ error: "missing env" }, { status: 500 });
    }

    const token = req.cookies.get("app_session")?.value;
    if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const payload = verifySessionJWT(token, sessionSecret);
    const lineSub = typeof payload?.line_sub === "string" ? payload.line_sub : null;
    if (!lineSub) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const supabaseAdmin = createClient(url, serviceKey);
    const displayName = typeof payload?.name === "string" ? payload.name : null;
    const picture = typeof payload?.picture === "string" ? payload.picture : null;
    const linkedUser = await findOrCreateLineUser(supabaseAdmin, lineSub, displayName, picture);
    if ("error" in linkedUser) {
      return NextResponse.json({ error: linkedUser.error }, { status: 500 });
    }

    const { error } = await supabaseAdmin
      .from("privacy_notice_acknowledgements")
      .upsert(
        {
          user_id: linkedUser.userId,
          policy_version: PRIVACY_NOTICE_VERSION,
          acknowledged_at: new Date().toISOString(),
          source: "booking",
        },
        { onConflict: "user_id,policy_version" }
      );

    if (error) {
      return NextResponse.json(
        { error: "privacy_notice_acknowledgement_failed" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { ok: true, policy_version: PRIVACY_NOTICE_VERSION },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: unknown) {
    console.error("privacy notice acknowledgement failed:", err);
    return NextResponse.json({ error: "privacy_notice_acknowledgement_failed" }, { status: 500 });
  }
}
