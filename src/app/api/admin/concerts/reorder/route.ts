import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/adminAuth";
import { logAdminAction } from "@/lib/adminAudit";
import { logServerError } from "@/lib/apiLog";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SCOPE = "/api/admin/concerts/reorder";

// PATCH /api/admin/concerts/reorder — body: { ids: string[] }
// ids = ลำดับที่ต้องการทั้งชุด ตัวแรก = ขึ้นบนสุด
export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // ตรวจ body แบบเข้ม — ต้องระบุ ids ชัดเจน ไม่เดาให้
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง (ต้องเป็น JSON)" }, { status: 400 });
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง (ต้องเป็น JSON object)" }, { status: 400 });
  }

  const raw = (body as Record<string, unknown>).ids;
  if (!Array.isArray(raw)) {
    return NextResponse.json({ error: "ต้องระบุ ids เป็น array ของรหัสคอนเสิร์ต" }, { status: 400 });
  }
  if (raw.length === 0) {
    return NextResponse.json({ error: "ids ต้องมีอย่างน้อย 1 รายการ" }, { status: 400 });
  }
  if (raw.length > 500) {
    return NextResponse.json({ error: "จัดลำดับได้สูงสุด 500 รายการต่อครั้ง" }, { status: 400 });
  }
  if (!raw.every((v) => typeof v === "string" && uuidRe.test(v))) {
    return NextResponse.json({ error: "ids ต้องเป็น uuid ทั้งหมด" }, { status: 400 });
  }
  const ids = raw as string[];
  if (new Set(ids).size !== ids.length) {
    return NextResponse.json({ error: "มีรหัสคอนเสิร์ตซ้ำใน ids" }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // เขียนผ่าน RPC ให้ทั้งชุดอยู่ในทรานแซกชันเดียว — ถ้าพลาดกลางทาง
  // ลำดับจะเพี้ยนครึ่งๆ กลางๆ แก้ตามยาก (ดู scripts/add_concert_sort_order.sql)
  const { data, error } = await supabase.rpc("set_concert_order", { p_ids: ids });

  if (error) {
    logServerError(SCOPE, error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const r = data as {
    ok?: boolean; error?: string; given?: number; found?: number; updated?: number;
  } | null;

  if (!r || typeof r !== "object") {
    logServerError(SCOPE, "RPC set_concert_order คืน null");
    return NextResponse.json(
      { error: "ฐานข้อมูลไม่ตอบผลลัพธ์ — ยังไม่ได้บันทึกลำดับ กรุณาลองใหม่" },
      { status: 500 }
    );
  }

  if (r.error) {
    switch (r.error) {
      case "EMPTY":
        return NextResponse.json({ error: "ไม่มีรายการให้จัดลำดับ" }, { status: 400 });
      case "DUPLICATE_ID":
        return NextResponse.json({ error: "มีรหัสคอนเสิร์ตซ้ำใน ids" }, { status: 400 });
      case "UNKNOWN_ID":
        return NextResponse.json(
          {
            error:
              `มีคอนเสิร์ตที่ไม่มีอยู่จริงในรายการ (ส่งมา ${r.given ?? 0} พบจริง ${r.found ?? 0}) — ` +
              "อาจมีคนลบคอนเสิร์ตไประหว่างที่เปิดหน้านี้ค้างไว้ กรุณารีเฟรชหน้าแล้วจัดใหม่",
          },
          { status: 409 }
        );
      default:
        logServerError(SCOPE, r.error);
        return NextResponse.json({ error: r.error }, { status: 400 });
    }
  }

  await logAdminAction({
    username: String(admin.payload.username ?? ""),
    action: "จัดลำดับคอนเสิร์ต",
    detail: `จัดลำดับ ${r.given ?? ids.length} รายการ (เปลี่ยนจริง ${r.updated ?? 0} รายการ)`,
  });

  return NextResponse.json({ ok: true, updated: r.updated ?? 0 });
}
