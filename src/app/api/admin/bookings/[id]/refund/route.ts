import { after, NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import {
  cancellationContext, cancellationDatabaseError, cancellationRpcError, REFUND_PROOF_BUCKET, syncCancelledBooking,
} from "@/lib/bookingCancellationServer";
import { sniffImageMimeType, validateImageUpload } from "@/lib/imageUpload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id?: string }> };

// Claim before manually transferring. A claim never expires automatically:
// otherwise another admin could transfer again after a timeout/interruption.
export async function PATCH(req: NextRequest, ctx: Context) {
  const auth = await cancellationContext(req, ctx.params);
  if (auth.error) return auth.error;
  const body = await req.json().catch(() => null);
  if (!["claim", "release"].includes(body?.action) || (body.action === "release" && body.not_transferred !== true)) {
    return NextResponse.json({ error: "คำสั่งไม่ถูกต้อง หรือต้องยืนยันว่ายังไม่ได้โอนก่อนคืนงาน" }, { status: 400 });
  }
  const { data, error } = await auth.supabase.rpc("admin_manage_booking_refund", {
    p_booking_id: auth.id, p_admin_id: auth.adminId, p_action: body.action,
  });
  if (error) return cancellationDatabaseError(error);
  const failed = cancellationRpcError(data);
  return failed ?? NextResponse.json({ ok: true, unchanged: data.unchanged === true });
}

// Record an already-completed manual bank transfer, not an instruction to pay.
export async function POST(req: NextRequest, ctx: Context) {
  const auth = await cancellationContext(req, ctx.params);
  if (auth.error) return auth.error;
  const form = await req.formData().catch(() => null);
  const proof = form?.get("proof");
  const reference = form?.get("reference");
  if (typeof reference !== "string" || reference.trim().length < 3 || reference.trim().length > 120 || form?.get("transferred") !== "true") {
    return NextResponse.json({ error: "ระบุเลขอ้างอิง 3–120 ตัวอักษร และยืนยันว่าโอนคืน 100 บาทแล้ว" }, { status: 400 });
  }
  if (!(proof instanceof File) || proof.size === 0) return NextResponse.json({ error: "กรุณาแนบภาพหลักฐานโอนคืน" }, { status: 400 });
  const invalid = validateImageUpload(proof);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
  const { supabase, id, adminId } = auth;
  // Check BEFORE storing a file, then check again under a lock inside the RPC.
  const { data: c, error: readError } = await supabase.from("booking_cancellations")
    .select("refund_status,processing_by").eq("booking_id", id).maybeSingle();
  if (readError) return cancellationDatabaseError(readError);
  if (!c) return NextResponse.json({ error: "ไม่พบรายการคืนเงิน" }, { status: 404 });
  if (c.refund_status === "refunded") return NextResponse.json({ ok: true, unchanged: true });
  if (c.refund_status !== "processing" || c.processing_by !== adminId) return NextResponse.json({ error: "ต้องรับงานคืนเงินด้วยบัญชีนี้ก่อน ห้ามโอนซ้ำ" }, { status: 409 });
  const buffer = Buffer.from(await proof.arrayBuffer());
  const mime = sniffImageMimeType(buffer);
  if (!mime) return NextResponse.json({ error: "หลักฐานต้องเป็นรูป JPG, PNG หรือ WebP จริง" }, { status: 400 });
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  const path = `${id}/${randomUUID()}.${ext}`;
  const { error: uploadError } = await supabase.storage.from(REFUND_PROOF_BUCKET).upload(path, buffer, { contentType: mime, upsert: false });
  if (uploadError) return cancellationDatabaseError(uploadError);
  const { data, error } = await supabase.rpc("admin_manage_booking_refund", {
    p_booking_id: id, p_admin_id: adminId, p_action: "complete",
    p_reference: reference.trim(), p_proof_path: path,
  });
  // An RPC network error may arrive AFTER commit. Keep the file in that case;
  // deleting it would destroy the evidence of a successfully recorded refund.
  if (error) return cancellationDatabaseError(error);
  const failed = cancellationRpcError(data);
  if (data?.error || data?.unchanged === true) {
    await supabase.storage.from(REFUND_PROOF_BUCKET).remove([path]).catch(() => {});
  }
  if (failed) return failed;
  after(() => syncCancelledBooking(supabase, id));
  return NextResponse.json({ ok: true, unchanged: data.unchanged === true });
}

// Only admins can access refund evidence. URLs expire in 5 minutes.
export async function GET(req: NextRequest, ctx: Context) {
  const auth = await cancellationContext(req, ctx.params);
  if (auth.error) return auth.error;
  const { data, error } = await auth.supabase.from("booking_cancellations")
    .select("refund_proof_path,refund_status").eq("booking_id", auth.id).maybeSingle();
  if (error) return cancellationDatabaseError(error);
  if (data?.refund_status !== "refunded" || !data.refund_proof_path) return NextResponse.json({ error: "ยังไม่มีหลักฐานคืนเงิน" }, { status: 404 });
  const signed = await auth.supabase.storage.from(REFUND_PROOF_BUCKET).createSignedUrl(data.refund_proof_path, 300);
  if (signed.error || !signed.data) return cancellationDatabaseError(signed.error ?? { message: "Missing signed URL" });
  return NextResponse.json({ url: signed.data.signedUrl }, { headers: { "Cache-Control": "no-store" } });
}
