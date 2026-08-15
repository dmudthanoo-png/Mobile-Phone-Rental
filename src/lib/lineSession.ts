import crypto from "crypto";
import { SupabaseClient } from "@supabase/supabase-js";

function base64url(input: Buffer | string) {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

// สร้าง JWT แบบ HS256 ง่ายๆ (session ของเราเอง) — logic เดียวกับที่ใช้ใน OAuth callback เดิม
export function signSessionJWT(payload: Record<string, unknown>, secret: string, expiresInSec: number) {
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

/**
 * หา user_id ที่ผูกกับ LINE sub นี้ ถ้ายังไม่มีให้สร้างใหม่ทั้ง auth.users,
 * line_identities, และ upsert profiles — logic เดียวกับ OAuth callback เดิม
 * เพื่อให้ผู้ใช้คนเดียวกันไม่ว่าจะ login ผ่าน OAuth หรือ LIFF ก็ได้ user_id เดิม
 */
export async function findOrCreateLineUser(
  supabaseAdmin: SupabaseClient,
  lineSub: string,
  displayName: string | null,
  picture: string | null
): Promise<{ userId: string } | { error: string }> {
  const { data: ident, error: identErr } = await supabaseAdmin
    .from("line_identities")
    .select("user_id")
    .eq("line_sub", lineSub)
    .maybeSingle();

  if (identErr) return { error: `line_identity_lookup_failed: ${identErr.message}` };

  let userId: string | null = ident?.user_id ?? null;

  if (!userId) {
    const email = `line_${lineSub}@example.invalid`;

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { provider: "line", line_sub: lineSub, name: displayName, picture },
    });

    if (createErr || !created?.user?.id) {
      return { error: `supabase_create_user_failed: ${createErr?.message || "no_user_returned"}` };
    }

    userId = created.user.id;

    const { error: mapErr } = await supabaseAdmin
      .from("line_identities")
      .insert({ line_sub: lineSub, user_id: userId });

    if (mapErr) return { error: `line_identity_insert_failed: ${mapErr.message}` };
  }

  const { error: profErr } = await supabaseAdmin
    .from("profiles")
    .upsert({ id: userId, line_sub: lineSub, name: displayName, picture }, { onConflict: "id" });

  if (profErr) return { error: `profile_upsert_failed: ${profErr.message}` };

  return { userId };
}
