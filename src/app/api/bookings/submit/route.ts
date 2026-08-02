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

export async function POST(req: NextRequest) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const sessionSecret = process.env.APP_SESSION_SECRET;

    if (!url || !serviceKey || !sessionSecret) {
      return NextResponse.json(
        { error: "missing env (SUPABASE_SERVICE_ROLE_KEY / APP_SESSION_SECRET / SUPABASE URL)" },
        { status: 500 }
      );
    }

    const supabaseAdmin = createClient(url, serviceKey);

    // verify cookie session
    const token = req.cookies.get("app_session")?.value;
    if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const payload = verifySessionJWT(token, sessionSecret);
    if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const lineSub = payload?.line_sub as string | undefined;
    if (!lineSub) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    // ✅ เอา user_id จาก payload ก่อน (ใหม่)
    let userId = payload?.app_user_id as string | undefined;

    // ✅ fallback (รองรับ session เก่า): lookup จาก line_identities
    if (!userId) {
      const { data: ident, error: identErr } = await supabaseAdmin
        .from("line_identities")
        .select("user_id")
        .eq("line_sub", lineSub)
        .maybeSingle();

      if (identErr) {
        console.error("line_identities lookup error:", identErr);
        return NextResponse.json({ error: `identity lookup failed: ${identErr.message}` }, { status: 500 });
      }

      userId = ident?.user_id ?? undefined;
    }

    // ถ้ายังไม่มี แสดงว่า user ยังไม่ได้ถูกสร้าง/ผูกจาก callback
    if (!userId) {
      return NextResponse.json(
        { error: "user not linked. please login again." },
        { status: 401 }
      );
    }

    const form = await req.formData();

    const renter_name = String(form.get("renter_name") ?? "");
    const renter_phone = String(form.get("renter_phone") ?? "");
    const package_id = String(form.get("package_id") ?? "");
    const package_name = String(form.get("package_name") ?? "");
    const rental_date = String(form.get("rental_date") ?? "");
    const venue_id = String(form.get("venue_id") ?? "");
    const venue_name = String(form.get("venue_name") ?? "");
    const total_amount = Number(form.get("total_amount") ?? 0);

    const slip = form.get("slip");

    if (
      !renter_name ||
      !renter_phone ||
      !package_id ||
      !package_name ||
      !rental_date ||
      !venue_id ||
      !venue_name ||
      !total_amount
    ) {
      return NextResponse.json({ error: "missing required fields" }, { status: 400 });
    }

    if (!(slip instanceof File)) {
      return NextResponse.json({ error: "missing slip file" }, { status: 400 });
    }

    const allowed = ["image/jpeg", "image/png", "image/jpg", "image/webp"];
    if (!allowed.includes(slip.type)) {
      return NextResponse.json({ error: `unsupported file type: ${slip.type}` }, { status: 400 });
    }

    // upload slip
    let slip_url: string | null = null;
    {
      const ext = slip.type === "image/png" ? "png" : "jpg";
      const fileName = `${lineSub}_${Date.now()}.${ext}`;

      const buffer = Buffer.from(await slip.arrayBuffer());

      const { error: upErr } = await supabaseAdmin.storage
        .from("slips")
        .upload(fileName, buffer, {
          contentType: slip.type,
          upsert: true,
        });

      if (upErr) {
        console.error("upload error:", upErr);
        return NextResponse.json({ error: `upload failed: ${upErr.message}` }, { status: 500 });
      }

      const { data } = supabaseAdmin.storage.from("slips").getPublicUrl(fileName);
      slip_url = data.publicUrl ?? null;
    }

    const ref_number = `RT-${Math.floor(100000 + Math.random() * 900000)}`;

    const { error: insErr } = await supabaseAdmin.from("bookings").insert({
      // ✅ ของใหม่: ผูก user_id มาตรฐาน
      user_id: userId,

      // (ยังเก็บ line_sub ไว้ชั่วคราวได้)
      line_sub: lineSub,

      renter_name,
      renter_phone,
      package_id,
      package_name,
      rental_date,
      venue_id,
      venue_name,
      total_amount,
      slip_url,
      ref_number,
      status: "pending",
    });

    if (insErr) {
      console.error("insert error:", insErr);
      return NextResponse.json({ error: `insert failed: ${insErr.message}` }, { status: 500 });
    }

    return NextResponse.json({ ok: true, ref_number }, { status: 200 });
  } catch (err: any) {
    console.error("submit booking fatal error:", err);
    return NextResponse.json({ error: err?.message || "server_error" }, { status: 500 });
  }
}