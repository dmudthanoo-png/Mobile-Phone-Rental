import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

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
    if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const lineSub = payload?.line_sub as string | undefined;
    if (!lineSub) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const supabaseAdmin = createClient(url, serviceKey);

    // ✅ หา user_id ให้ “เหมือน /api/bookings/my-v2”
    let user_id = payload?.app_user_id as string | undefined;

    if (!user_id) {
      const { data: ident, error: identErr } = await supabaseAdmin
        .from("line_identities")
        .select("user_id")
        .eq("line_sub", lineSub)
        .maybeSingle();

      if (identErr) return NextResponse.json({ error: identErr.message }, { status: 500 });
      user_id = ident?.user_id ?? undefined;
    }

    if (!user_id) {
      return NextResponse.json(
        { error: "user not linked. please login again." },
        { status: 401 }
      );
    }

    // 2) parse form-data
    const form = await req.formData();

    const session_id = String(form.get("session_id") ?? "").trim();
    const phone_id = String(form.get("phone_id") ?? "").trim();
    const renter_name = String(form.get("renter_name") ?? "").trim();
    const renter_phone = String(form.get("renter_phone") ?? "").trim();

    // ✅ validate total_amount
    let amount = Number(form.get("total_amount") ?? 0);
    if (!Number.isFinite(amount)) amount = 0;
    amount = Math.max(0, Math.floor(amount));

    const slip = form.get("slip");

    if (!session_id) return NextResponse.json({ error: "missing session_id" }, { status: 400 });
    if (!phone_id) return NextResponse.json({ error: "missing phone_id" }, { status: 400 });
    if (!renter_name) return NextResponse.json({ error: "missing renter_name" }, { status: 400 });
    if (!renter_phone) return NextResponse.json({ error: "missing renter_phone" }, { status: 400 });
    if (!(slip instanceof File)) {
      return NextResponse.json({ error: "missing slip file" }, { status: 400 });
    }

    // กันไฟล์ใหญ่เกิน (ตัวอย่าง 8MB)
    const MAX_BYTES = 8 * 1024 * 1024;
    if (slip.size > MAX_BYTES) {
      return NextResponse.json({ error: "file_too_large" }, { status: 400 });
    }

    const allowed = ["image/jpeg", "image/png", "image/jpg", "image/webp"];
    if (!allowed.includes(slip.type)) {
      return NextResponse.json(
        { error: `unsupported file type: ${slip.type}` },
        { status: 400 }
      );
    }

    // 3) upload slip ก่อน
    const ext =
      slip.type === "image/png" ? "png" :
      slip.type === "image/webp" ? "webp" : "jpg";

    const fileName = `bookings/${user_id}/${session_id}/${phone_id}/${Date.now()}.${ext}`;
    const buffer = Buffer.from(await slip.arrayBuffer());

    const { error: upErr } = await supabaseAdmin.storage
      .from("slips")
      .upload(fileName, buffer, { contentType: slip.type, upsert: true });

    if (upErr) {
      return NextResponse.json(
        { error: `upload failed: ${upErr.message}` },
        { status: 500 }
      );
    }

    const { data: pub } = supabaseAdmin.storage.from("slips").getPublicUrl(fileName);
    const slip_url = pub?.publicUrl ?? null;

    if (!slip_url) {
      // best-effort cleanup
      await supabaseAdmin.storage.from("slips").remove([fileName]).catch(() => {});
      return NextResponse.json({ error: "cannot_get_public_url" }, { status: 500 });
    }

    // 4) สร้าง booking แบบ atomic (กัน oversell) → pending (รอตรวจ)
    const rpc = await supabaseAdmin.rpc("create_pending_booking_if_available", {
      p_user_id: user_id,
      p_session_id: session_id,
      p_phone_id: phone_id,
      p_renter_name: renter_name,
      p_renter_phone: renter_phone,
      p_total_amount: amount,
      p_slip_url: slip_url,
      p_ref_number: null,
    });

    if (rpc.error) {
      const msg = rpc.error.message || "";

      // SOLD_OUT → ลบไฟล์ที่อัปไว้ทิ้ง (best-effort)
      if (msg.includes("SOLD_OUT")) {
        await supabaseAdmin.storage.from("slips").remove([fileName]).catch(() => {});
        return NextResponse.json({ error: "sold_out" }, { status: 409 });
      }

      // error อื่น ๆ → (จะลบไฟล์ก็ได้) แนะนำลบเพื่อไม่ให้ค้าง
      await supabaseAdmin.storage.from("slips").remove([fileName]).catch(() => {});
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    const row = Array.isArray(rpc.data) ? rpc.data[0] : null;

    if (!row?.booking_id) {
      // best-effort cleanup
      await supabaseAdmin.storage.from("slips").remove([fileName]).catch(() => {});
      return NextResponse.json({ error: "rpc_no_result" }, { status: 500 });
    }

    return NextResponse.json(
      {
        ok: true,
        booking_id: row.booking_id,
        ref_number: row.ref_number ?? null,
        slip_url,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: any) {
    console.error("upload-slip fatal error:", err);
    return NextResponse.json(
      { error: err?.message || "server_error" },
      { status: 500 }
    );
  }
}