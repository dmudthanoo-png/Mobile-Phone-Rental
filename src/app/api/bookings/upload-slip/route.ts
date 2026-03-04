import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

function base64urlToBuffer(b64url: string) {
  const b64 =
    b64url.replace(/-/g, "+").replace(/_/g, "/") +
    "===".slice((b64url.length + 3) % 4);
  return Buffer.from(b64, "base64");
}

function verifySessionJWT(token: string, secret: string) {
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

  const payload = JSON.parse(payloadJson) as { exp?: number; [k: string]: any };
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now > payload.exp) return null;

  return payload;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: NextRequest) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const sessionSecret = process.env.APP_SESSION_SECRET;

    if (!url || !serviceKey || !sessionSecret) {
      return NextResponse.json({ error: "missing env" }, { status: 500 });
    }

    // 1) verify user session
    const token = req.cookies.get("app_session")?.value;
    if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const payload = verifySessionJWT(token, sessionSecret);
    const lineSub = payload?.line_sub as string | undefined;
    if (!lineSub) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const form = await req.formData();
    const booking_id = String(form.get("booking_id") ?? "");
    const slip = form.get("slip");

    if (!booking_id) return NextResponse.json({ error: "missing booking_id" }, { status: 400 });
    if (!(slip instanceof File)) return NextResponse.json({ error: "missing slip file" }, { status: 400 });

    // กันไฟล์ใหญ่เกิน (ตัวอย่าง 8MB)
    const MAX_BYTES = 8 * 1024 * 1024;
    if (slip.size > MAX_BYTES) {
      return NextResponse.json({ error: "file_too_large" }, { status: 400 });
    }

    const allowed = ["image/jpeg", "image/png", "image/jpg", "image/webp"];
    if (!allowed.includes(slip.type)) {
      return NextResponse.json({ error: `unsupported file type: ${slip.type}` }, { status: 400 });
    }

    const supabaseAdmin = createClient(url, serviceKey);

    // 2) หา user_id จาก profiles.line_sub
    const prof = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("line_sub", lineSub)
      .maybeSingle();

    if (prof.error) return NextResponse.json({ error: prof.error.message }, { status: 500 });

    const user_id = prof.data?.id as string | undefined;
    if (!user_id) return NextResponse.json({ error: "profile_not_found" }, { status: 400 });

    // 3) โหลด booking แล้วเช็ค ownership + status + expiry
    const bk = await supabaseAdmin
      .from("bookings")
      .select("id, user_id, status, pending_expires_at, slip_url, slip_uploaded_at")
      .eq("id", booking_id)
      .maybeSingle();

    if (bk.error) return NextResponse.json({ error: bk.error.message }, { status: 500 });
    if (!bk.data) return NextResponse.json({ error: "booking_not_found" }, { status: 404 });

    if (bk.data.user_id !== user_id) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    if (bk.data.status !== "pending") return NextResponse.json({ error: "booking_not_pending" }, { status: 400 });

    // ถ้าเคยอัปแล้ว ป้องกันอัปซ้ำ
    if (bk.data.slip_url || bk.data.slip_uploaded_at) {
      return NextResponse.json({ error: "slip_already_uploaded" }, { status: 400 });
    }

    // expiry check: ถ้าหมดอายุแล้ว ห้ามอัป
    const expiresAt = bk.data.pending_expires_at as string | null;
    if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
      return NextResponse.json({ error: "pending_expired" }, { status: 410 });
    }

    // 4) upload slip
    const ext =
      slip.type === "image/png" ? "png" :
      slip.type === "image/webp" ? "webp" : "jpg";

    const fileName = `bookings/${booking_id}/${Date.now()}.${ext}`;
    const buffer = Buffer.from(await slip.arrayBuffer());

    const { error: upErr } = await supabaseAdmin.storage
      .from("slips")
      .upload(fileName, buffer, { contentType: slip.type, upsert: true });

    if (upErr) return NextResponse.json({ error: `upload failed: ${upErr.message}` }, { status: 500 });

    const { data: pub } = supabaseAdmin.storage.from("slips").getPublicUrl(fileName);
    const slip_url = pub?.publicUrl ?? null;

    if (!slip_url) {
      return NextResponse.json({ error: "cannot_get_public_url" }, { status: 500 });
    }

    // 5) update booking: set slip + mark uploaded_at + ปลด expiry (pending_expires_at = null)
    const upd = await supabaseAdmin
      .from("bookings")
      .update({
        slip_url,
        slip_uploaded_at: new Date().toISOString(),
        pending_expires_at: null,
      })
      .eq("id", booking_id)
      .eq("user_id", user_id)
      .eq("status", "pending");

    if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 500 });

    return NextResponse.json(
      { ok: true, slip_url },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: any) {
    console.error("upload-slip fatal error:", err);
    return NextResponse.json({ error: err?.message || "server_error" }, { status: 500 });
  }
}