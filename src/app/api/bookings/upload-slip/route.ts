import { NextRequest, NextResponse, after } from "next/server";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { syncBookingToSheet } from "@/lib/sheetsSync";
import { verifySlipForBooking } from "@/lib/slipOk";
import { findOrCreateLineUser } from "@/lib/lineSession";
import { sniffImageMimeType } from "@/lib/imageUpload";
import { PRIVACY_NOTICE_VERSION } from "@/lib/privacyNotice";

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

  const payload = JSON.parse(payloadJson) as { exp?: number; [k: string]: unknown };
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

    // ใช้ LINE sub เป็นตัวตนหลัก และซ่อม profiles อัตโนมัติสำหรับ session เก่า
    // เพื่อให้ bookings.user_id มีแถวอ้างอิงครบทั้ง auth.users และ profiles
    const displayName = typeof payload.name === "string" ? payload.name : null;
    const picture = typeof payload.picture === "string" ? payload.picture : null;

    // 1.5+2) หา/สร้างผู้ใช้ กับ อ่าน multipart body (รวมไฟล์สลิป) พร้อมกัน — สองอย่างนี้ไม่ขึ้นต่อกัน
    // เดิมทำต่อคิวกันทำให้ต้องรอ round-trip ฐานข้อมูลจบก่อนถึงจะเริ่มรับไฟล์
    const [linkedUser, form] = await Promise.all([
      findOrCreateLineUser(supabaseAdmin, lineSub, displayName, picture),
      req.formData(),
    ]);

    if ("error" in linkedUser) {
      return NextResponse.json({ error: linkedUser.error }, { status: 500 });
    }

    const user_id = linkedUser.userId;

    const session_id   = String(form.get("session_id")   ?? "").trim();
    const phone_id     = String(form.get("phone_id")     ?? "").trim();
    const renter_name  = String(form.get("renter_name")  ?? "").trim();
    const renter_phone = String(form.get("renter_phone") ?? "").trim();
    const renter_line_name = String(form.get("renter_line_name") ?? "").trim().slice(0, 100);
    const lens_id      = String(form.get("lens_id")      ?? "").trim() || null;

    let qty = Number(form.get("qty") ?? 1);
    if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty < 1) qty = 1;
    qty = Math.min(qty, 10);

    let lens_qty = Number(form.get("lens_qty") ?? 0);
    if (!Number.isFinite(lens_qty) || !Number.isInteger(lens_qty) || lens_qty < 0) lens_qty = 0;
    lens_qty = Math.min(lens_qty, 10);
    if (!lens_id) lens_qty = 0;

    let amount = Number(form.get("total_amount") ?? 0);
    if (!Number.isFinite(amount)) amount = 0;
    amount = Math.max(0, Math.floor(amount));

    const slip = form.get("slip");

    if (!session_id)    return NextResponse.json({ error: "missing session_id" },    { status: 400 });
    if (!phone_id)      return NextResponse.json({ error: "missing phone_id" },      { status: 400 });
    if (!renter_name)   return NextResponse.json({ error: "missing renter_name" },   { status: 400 });
    if (!renter_phone)  return NextResponse.json({ error: "missing renter_phone" },  { status: 400 });
    if (!(slip instanceof File)) {
      return NextResponse.json({ error: "missing slip file" }, { status: 400 });
    }
    if (slip.size > 8 * 1024 * 1024) {
      return NextResponse.json({ error: "file_too_large" }, { status: 400 });
    }
    const allowed = ["image/jpeg", "image/png", "image/jpg", "image/webp"];
    if (!allowed.includes(slip.type)) {
      return NextResponse.json({ error: `unsupported file type: ${slip.type}` }, { status: 400 });
    }

    // 2.5-4) ตรวจทุกอย่างที่ไม่ขึ้นต่อกันพร้อมกันในรอบเดียว (เดิมยิงต่อคิวทีละ query รวม 7 round-trip
    // ทำให้ผู้ใช้ต้องรอสะสม) — ลำดับการ "เช็คผลลัพธ์" ยังเหมือนเดิมทุกประการ ข้อความ error จึงไม่เปลี่ยน
    // หมายเหตุ: รวม query concert_sessions ที่เดิมยิงซ้ำ 2 รอบ (เช็คสิทธิ์ + ดึงชื่อไป Google Sheet) เหลือรอบเดียว
    const [ackRes, sessionRes, phoneRes, priceRes, lensRes, pendingRes] = await Promise.all([
      // ต้องรับทราบนโยบายความเป็นส่วนตัวเวอร์ชันปัจจุบันก่อนเสมอ — เช็คฝั่ง server
      // ห้ามพึ่งแค่ลำดับการกดปุ่มฝั่ง client เพราะ endpoint นี้เรียกตรงได้โดยข้ามหน้า UI
      supabaseAdmin
        .from("privacy_notice_acknowledgements")
        .select("user_id")
        .eq("user_id", user_id)
        .eq("policy_version", PRIVACY_NOTICE_VERSION)
        .maybeSingle(),
      // verify session ว่ามีอยู่จริง + คอนเสิร์ตยังไม่ archive (กันจองรอบที่เก็บเข้าคลังไปแล้ว)
      // + รอบยังไม่ผ่านไปแล้ว (กันจองย้อนหลังรอบที่จบไปแล้วจาก session_id เก่าที่ค้างอยู่)
      // + คอนเสิร์ตต้องแสดงผลอยู่ และถึงเวลาเผยแพร่แล้ว (กันจองข้ามขั้นตอนผ่าน session_id/phone_id ตรงๆ
      //   โดยไม่ผ่านหน้าเว็บที่ซ่อน/ยังไม่เปิดคอนเสิร์ตนี้ไว้ — เหมือนที่กันไว้แล้วใน /api/concerts/[id])
      supabaseAdmin
        .from("concert_sessions")
        .select("id, start_at, note, concerts ( archived, is_visible, publish_at, title )")
        .eq("id", session_id)
        .maybeSingle(),
      // verify price จาก DB (ไม่เชื่อ client) — ต้อง active เท่านั้นถึงจะจองได้
      supabaseAdmin
        .from("phones")
        .select("model_name, price, deposit")
        .eq("id", phone_id)
        .eq("active", true)
        .maybeSingle(),
      // ราคาค่าเช่าอาจถูกตั้งแยกเฉพาะรอบนี้ไว้ (เช่น คอนเสิร์ตใหญ่ขึ้นราคา) — ไม่ได้ตั้ง = ใช้ราคาตั้งต้นของรุ่น
      supabaseAdmin
        .from("session_phone_inventory")
        .select("price_override")
        .eq("session_id", session_id)
        .eq("phone_id", phone_id)
        .maybeSingle(),
      // ต้องเป็นเลนส์ที่ผูกกับมือถือรุ่นนี้จริง (ยิงเฉพาะตอนเลือกเลนส์มาด้วย)
      lens_id && lens_qty > 0
        ? supabaseAdmin
            .from("phone_lenses")
            .select("lens_id, lenses ( name, price, active )")
            .eq("phone_id", phone_id)
            .eq("lens_id", lens_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      // rate limit — นับตาม user_id (ตัวตนจริงจาก LINE login) ไม่ใช่ renter_phone
      // เพราะ renter_phone เป็นช่องกรอกอิสระ เปลี่ยนเบอร์ไปเรื่อยๆ เพื่อหลบ limit ได้ถ้านับแค่เบอร์
      supabaseAdmin
        .from("bookings")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user_id)
        .eq("status", "pending"),
    ]);

    if (ackRes.error) return NextResponse.json({ error: ackRes.error.message }, { status: 500 });
    if (!ackRes.data) {
      return NextResponse.json({ error: "privacy_notice_not_acknowledged" }, { status: 403 });
    }

    const sessionCheck = sessionRes.data;
    if (sessionRes.error) return NextResponse.json({ error: sessionRes.error.message }, { status: 500 });
    if (!sessionCheck) return NextResponse.json({ error: "session not found" }, { status: 404 });
    const concertRow = sessionCheck.concerts as unknown as { archived: boolean; is_visible: boolean | null; publish_at: string | null; title: string | null } | null;
    if (concertRow?.archived) return NextResponse.json({ error: "concert archived" }, { status: 400 });
    if (concertRow?.is_visible === false) return NextResponse.json({ error: "concert hidden" }, { status: 400 });
    if (concertRow?.publish_at && new Date(concertRow.publish_at).getTime() > Date.now()) {
      return NextResponse.json({ error: "concert not published yet" }, { status: 400 });
    }
    if (sessionCheck.start_at && new Date(sessionCheck.start_at).getTime() < Date.now()) {
      return NextResponse.json({ error: "session already passed" }, { status: 400 });
    }

    const phoneRow = phoneRes.data;
    if (phoneRes.error) return NextResponse.json({ error: phoneRes.error.message }, { status: 500 });
    if (!phoneRow) return NextResponse.json({ error: "phone not found" }, { status: 404 });

    if (priceRes.error) return NextResponse.json({ error: priceRes.error.message }, { status: 500 });

    const basePrice = Number(priceRes.data?.price_override ?? phoneRow.price ?? 0);
    const deposit   = Number(phoneRow.deposit ?? 0);

    let lensPrice = 0;
    let lensName: string | null = null;
    if (lens_id && lens_qty > 0) {
      if (lensRes.error) return NextResponse.json({ error: lensRes.error.message }, { status: 500 });
      const linkRow = lensRes.data;
      const lensInfo = linkRow?.lenses as unknown as { name: string; price: number; active: boolean } | null;
      if (!linkRow || !lensInfo || lensInfo.active === false) {
        return NextResponse.json({ error: "lens not available for this phone" }, { status: 400 });
      }
      lensPrice = Number(lensInfo.price ?? 0);
      lensName = lensInfo.name ?? null;
    }

    // คำนวณ expected amount ฝั่ง server (ตามจำนวนเครื่อง + เลนส์)
    // มัดจำรวมอยู่ในค่าเช่าแล้ว ไม่บวกเพิ่มเข้ายอดรวม
    const expectedAmount = Math.round(basePrice * qty + lensPrice * lens_qty);
    // ยอดมัดจำที่ลูกค้าโอนจริง ต้องไม่เกินยอดรวม
    const depositDue = Math.min(Math.round(deposit * qty), expectedAmount);
    const verifiedAmount = expectedAmount;

    // ชื่อคอนเสิร์ต + รอบ (สำหรับ sync ไป Google Sheet ให้อ่านง่าย) — ได้จาก query เดียวกันข้างบนแล้ว
    const concertTitle = concertRow?.title ?? null;
    const sessionLabel = sessionCheck.start_at
      ? `${sessionCheck.note ?? "รอบ"} • ${new Date(sessionCheck.start_at).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })}`
      : null;

    const pendingCount = pendingRes.count;
    if (pendingRes.error) return NextResponse.json({ error: pendingRes.error.message }, { status: 500 });

    if ((pendingCount ?? 0) >= 3) {
      return NextResponse.json(
        { error: "มีการจองที่รอยืนยันอยู่แล้ว กรุณารอให้แอดมินตรวจสอบก่อน" },
        { status: 429 }
      );
    }

    // 5) upload slip — เช็ค magic bytes จริงของไฟล์ ไม่เชื่อแค่ Content-Type ที่ client อ้าง
    const buffer      = Buffer.from(await slip.arrayBuffer());
    const sniffedType = sniffImageMimeType(buffer);
    if (!sniffedType) {
      return NextResponse.json({ error: "ไฟล์ไม่ใช่รูปภาพที่รองรับ (ตรวจสอบจากเนื้อหาไฟล์จริงแล้วไม่ตรง)" }, { status: 400 });
    }

    const ext = sniffedType === "image/png" ? "png" : sniffedType === "image/webp" ? "webp" : "jpg";
    const fileName = `bookings/${user_id}/${session_id}/${phone_id}/${Date.now()}.${ext}`;

    const { error: upErr } = await supabaseAdmin.storage
      .from("slips")
      .upload(fileName, buffer, { contentType: sniffedType, upsert: true });

    if (upErr) {
      return NextResponse.json({ error: `upload failed: ${upErr.message}` }, { status: 500 });
    }

    const { data: pub } = supabaseAdmin.storage.from("slips").getPublicUrl(fileName);
    const slip_url = pub?.publicUrl ?? null;

    if (!slip_url) {
      await supabaseAdmin.storage.from("slips").remove([fileName]).catch(() => {});
      return NextResponse.json({ error: "cannot_get_public_url" }, { status: 500 });
    }

    // 6) เปลี่ยน "เครื่องที่กันไว้" ให้เป็นการจองจริงแบบ atomic (เติมสลิป + ล้างวันหมดอายุ)
    //    ถ้าของที่กันไว้หมดอายุ/ไม่มีแล้ว RPC จะเช็คสต็อกแล้วสร้างใหม่ให้เหมือนเดิม (ถ้าของยังเหลือ)
    const rpc = await supabaseAdmin.rpc("finalize_booking_with_slip", {
      p_user_id:      user_id,
      p_session_id:   session_id,
      p_phone_id:     phone_id,
      p_qty:          qty,
      p_lens_id:      lens_id,
      p_lens_qty:     lens_qty,
      p_renter_name:  renter_name,
      p_renter_phone: renter_phone,
      p_total_amount: verifiedAmount,
      p_slip_url:     slip_url,
      p_deposit_amount: depositDue,
    });

    if (rpc.error) {
      const msg = rpc.error.message || "";
      await supabaseAdmin.storage.from("slips").remove([fileName]).catch(() => {});
      if (msg.includes("SOLD_OUT_PHONE")) {
        return NextResponse.json({ error: "sold_out" }, { status: 409 });
      }
      if (msg.includes("SOLD_OUT_LENS")) {
        return NextResponse.json({ error: "lens_sold_out" }, { status: 409 });
      }
      if (msg.includes("PHONE_NOT_CONFIGURED_FOR_SESSION")) {
        return NextResponse.json({ error: "sold_out" }, { status: 409 });
      }
      if (msg.includes("LENS_NOT_CONFIGURED_FOR_SESSION")) {
        return NextResponse.json({ error: "lens_sold_out" }, { status: 409 });
      }
      if (msg.includes("TOO_MANY_PENDING")) {
        // เผื่อยิง request จองพร้อมกันหลายอันแซงการเช็คด่านแรกไปได้ — RPC เองก็กันซ้ำอีกชั้นด้วย advisory lock
        return NextResponse.json(
          { error: "มีการจองที่รอยืนยันอยู่แล้ว กรุณารอให้แอดมินตรวจสอบก่อน" },
          { status: 429 }
        );
      }
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    const rpcRow = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
    const row = rpcRow as { booking_id: string; ref_number: string } | null;

    if (!row?.booking_id) {
      await supabaseAdmin.storage.from("slips").remove([fileName]).catch(() => {});
      return NextResponse.json({ error: "rpc_no_result" }, { status: 500 });
    }

    // เก็บชื่อไลน์ลง booking (เผื่อกรณีที่ hold หมดอายุแล้ว RPC สร้างแถวใหม่ ชื่อไลน์จะไม่หาย)
    if (renter_line_name) {
      await supabaseAdmin.from("bookings").update({ renter_line_name }).eq("id", row.booking_id);
    }

    // 7) บันทึก snapshot ราคาเลนส์ลง booking (สำหรับแสดงผลในหน้าประวัติ)
    if (lens_id && lens_qty > 0 && lensPrice) {
      const { error: lensErr } = await supabaseAdmin
        .from("bookings")
        .update({ add_lens: true, lens_price: lensPrice * lens_qty })
        .eq("id", row.booking_id);

      if (lensErr) {
        console.error("lens update failed:", lensErr.message);
        // ไม่ return error — booking สร้างสำเร็จแล้ว แค่ log ไว้
      }
    }

    // 7.5-8) งาน best-effort ที่ทำ "หลังจองสำเร็จแล้ว" — ตรวจสลิปกับ SlipOK (timeout 15 วิ) และ
    // sync ไป Google Sheet (timeout 5 วิ) เดิม await ทั้งคู่ก่อนตอบกลับ ทำให้ลูกค้าต้องนั่งรอสูงสุด
    // ~20 วินาทีทั้งที่การจองเสร็จเรียบร้อยไปแล้ว และผลลัพธ์ของสองงานนี้ไม่ได้ถูกส่งกลับไปให้ลูกค้าเลย
    //
    // ย้ายมาใช้ after() ของ Next.js — ตอบกลับลูกค้าทันที แล้วรันสองงานนี้ต่อเบื้องหลัง
    // (after() ออกแบบมาสำหรับเคสนี้โดยเฉพาะ รับประกันว่างานจะรันจบก่อน serverless function ถูก freeze
    //  ซึ่งเป็นเหตุผลเดิมที่ต้อง await ไว้) และรันสองงานพร้อมกันด้วย ไม่ต้องรอต่อคิวกันเอง
    after(async () => {
      await Promise.all([
        verifySlipForBooking(row.booking_id).catch((err) => {
          console.error("auto slip verify failed:", err instanceof Error ? err.message : err);
        }),
        syncBookingToSheet({
          event: "created",
          booking_id: row.booking_id,
          ref_number: row.ref_number ?? null,
          status: "pending",
          renter_name,
          renter_phone,
          concert_title: concertTitle,
          session_label: sessionLabel,
          phone_model: phoneRow.model_name ?? null,
          qty,
          lens_name: lensName,
          lens_qty: lens_id && lens_qty > 0 ? lens_qty : 0,
          total_amount: verifiedAmount,
          created_at: new Date().toISOString(),
        }),
      ]);
    });

    return NextResponse.json(
      {
        ok:         true,
        booking_id: row.booking_id,
        ref_number: row.ref_number ?? null,
        slip_url,
        qty,
        lens_id,
        lens_qty,
        lens_price: lens_id && lens_qty > 0 ? lensPrice * lens_qty : 0,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "server_error";
    console.error("upload-slip fatal error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
