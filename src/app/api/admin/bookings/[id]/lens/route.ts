import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/adminAuth";
import { logAdminAction } from "@/lib/adminAudit";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceKey);
}

function money(n: number) {
  return n.toLocaleString("th-TH");
}

type InvRow = {
  lens_id: string;
  qty: number | null;
  lenses: { name: string; focal_mm: number | null; price: number | null; active: boolean | null } | null;
};

// GET /api/admin/bookings/[id]/lens
// ตัวเลือกเลนส์ของรอบนั้น + จำนวนที่เหลือ (ไม่นับรายการนี้เอง เพราะกำลังจะถูกเขียนทับ)
export async function GET(req: NextRequest, ctx: { params: Promise<{ id?: string }> }) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!id || !uuidRe.test(id)) {
    return NextResponse.json({ error: "invalid booking id" }, { status: 400 });
  }

  const supabase = getSupabase();

  const { data: bk, error: bkErr } = await supabase
    .from("bookings")
    .select("id, session_id, status, lens_id, lens_qty, lens_price, total_amount, deposit_amount")
    .eq("id", id)
    .maybeSingle();

  if (bkErr) return NextResponse.json({ error: bkErr.message }, { status: 500 });
  if (!bk) return NextResponse.json({ error: "ไม่พบรายการจองนี้" }, { status: 404 });

  // โควต้าเลนส์ที่แอดมินตั้งไว้ให้รอบนี้
  const { data: invRows, error: invErr } = await supabase
    .from("session_lens_inventory")
    .select("lens_id, qty, lenses:lens_id ( name, focal_mm, price, active )")
    .eq("session_id", bk.session_id);

  if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 });

  // ยอดที่ถูกจองไปแล้วในรอบนี้ — เงื่อนไขเดียวกับใน RPC (confirmed + pending ที่ยังไม่หมดเวลา)
  const nowIso = new Date().toISOString();
  const { data: bookedRows, error: bookedErr } = await supabase
    .from("bookings")
    .select("lens_id, lens_qty, status, pending_expires_at")
    .eq("session_id", bk.session_id)
    .not("lens_id", "is", null)
    .neq("id", id)
    .in("status", ["confirmed", "pending"]);

  if (bookedErr) return NextResponse.json({ error: bookedErr.message }, { status: 500 });

  const bookedByLens = new Map<string, number>();
  for (const row of bookedRows ?? []) {
    const counts =
      row.status === "confirmed" ||
      (row.status === "pending" && (!row.pending_expires_at || row.pending_expires_at > nowIso));
    if (!counts || !row.lens_id) continue;
    bookedByLens.set(row.lens_id, (bookedByLens.get(row.lens_id) ?? 0) + Number(row.lens_qty ?? 0));
  }

  const options = ((invRows ?? []) as unknown as InvRow[])
    .filter((r) => r.lenses)
    .map((r) => {
      const quota = Number(r.qty ?? 0);
      const booked = bookedByLens.get(r.lens_id) ?? 0;
      return {
        lens_id: r.lens_id,
        name: r.lenses!.name,
        focal_mm: r.lenses!.focal_mm,
        price: Number(r.lenses!.price ?? 0),
        active: r.lenses!.active !== false,
        quota,
        booked,
        // เหลือเท่าไหร่ถ้าจะย้ายรายการนี้มาใส่เลนส์ตัวนี้
        available: Math.max(0, quota - booked),
      };
    })
    .sort((a, b) => (a.focal_mm ?? 0) - (b.focal_mm ?? 0));

  return NextResponse.json(
    {
      booking: {
        id: bk.id,
        status: bk.status,
        lens_id: bk.lens_id,
        lens_qty: Number(bk.lens_qty ?? 0),
        lens_price: Number(bk.lens_price ?? 0),
        total_amount: Number(bk.total_amount ?? 0),
        deposit_amount: bk.deposit_amount == null ? null : Number(bk.deposit_amount),
      },
      // แก้ได้เฉพาะรายการที่ยืนยันแล้ว (รายการ pending ให้ปฏิเสธแล้วให้ลูกค้าจองใหม่)
      editable: bk.status === "confirmed",
      options,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

// PATCH /api/admin/bookings/[id]/lens — body: { lens_id: string|null, lens_qty: number }
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id?: string }> }) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!id || !uuidRe.test(id)) {
    return NextResponse.json({ error: "invalid booking id" }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as
    | { lens_id?: unknown; lens_qty?: unknown }
    | null;

  const rawLensId = body?.lens_id;
  const lensId =
    rawLensId === null || rawLensId === undefined || rawLensId === "" ? null : String(rawLensId);
  if (lensId !== null && !uuidRe.test(lensId)) {
    return NextResponse.json({ error: "lens_id ไม่ถูกต้อง" }, { status: 400 });
  }

  const lensQty = Number(body?.lens_qty ?? 0);
  if (!Number.isFinite(lensQty) || !Number.isInteger(lensQty) || lensQty < 0) {
    return NextResponse.json({ error: "lens_qty ต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป" }, { status: 400 });
  }
  if (lensId !== null && lensQty < 1) {
    return NextResponse.json({ error: "เลือกเลนส์แล้วต้องระบุจำนวนอย่างน้อย 1 ชิ้น" }, { status: 400 });
  }

  const supabase = getSupabase();

  // เขียนผ่าน RPC เพื่อให้ "ล็อกแถวจอง → ล็อกโควต้าเลนส์ของรอบ → นับยอดจอง → เขียน"
  // อยู่ในทรานแซกชันเดียวกัน (ดู scripts/add_admin_set_booking_lens_rpc.sql)
  const { data: rpcData, error: rpcErr } = await supabase.rpc("admin_set_booking_lens", {
    p_booking_id: id,
    p_lens_id: lensId,
    p_lens_qty: lensQty,
  });

  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });

  const r = rpcData as {
    ok?: boolean;
    error?: string;
    unchanged?: boolean;
    status?: string;
    lens_name?: string | null;
    lens_qty?: number;
    lens_price?: number;
    old_lens_name?: string | null;
    old_lens_qty?: number;
    old_lens_price?: number;
    old_total?: number;
    total_amount?: number;
    deposit_amount?: number | null;
    pay_on_pickup?: number;
    quota?: number;
    booked?: number;
    requested?: number;
    available?: number;
  } | null;

  if (r?.error) {
    switch (r.error) {
      case "NOT_FOUND":
        return NextResponse.json({ error: "ไม่พบรายการจองนี้" }, { status: 404 });
      case "NOT_CONFIRMED":
        return NextResponse.json(
          {
            error:
              `แก้เลนส์ได้เฉพาะรายการที่ยืนยันแล้ว (รายการนี้อยู่ในสถานะ ${r.status ?? "-"}) — ` +
              "ถ้ายังรอตรวจสอบ ให้ปฏิเสธแล้วให้ลูกค้าจองใหม่ได้เลย",
          },
          { status: 409 }
        );
      case "LENS_NOT_FOUND":
        return NextResponse.json({ error: "ไม่พบเลนส์ที่เลือก" }, { status: 404 });
      case "LENS_NOT_CONFIGURED_FOR_SESSION":
        return NextResponse.json(
          {
            error: `รอบนี้ยังไม่ได้ตั้งโควต้าเลนส์ "${r.lens_name ?? "-"}" ไว้ — ไปตั้งโควต้าเลนส์ของรอบก่อน แล้วกลับมาแก้อีกครั้ง`,
          },
          { status: 400 }
        );
      case "SOLD_OUT_LENS":
        return NextResponse.json(
          {
            error:
              `โควต้าเลนส์ "${r.lens_name ?? "-"}" ของรอบนี้ไม่พอ: ตั้งไว้ ${r.quota ?? 0} ชิ้น ` +
              `ถูกจองไปแล้ว ${r.booked ?? 0} ชิ้น เหลือ ${r.available ?? 0} ชิ้น แต่ขอ ${r.requested ?? 0} ชิ้น`,
          },
          { status: 409 }
        );
      case "LENS_QTY_TOO_LARGE":
        return NextResponse.json({ error: "จำนวนเลนส์สูงสุด 20 ชิ้นต่อรายการ" }, { status: 400 });
      case "TOTAL_WOULD_BE_NEGATIVE":
        return NextResponse.json(
          {
            error:
              "ยอดรวมจะติดลบ — ค่าเลนส์เดิมที่บันทึกไว้อาจไม่สอดคล้องกับยอดรวมของรายการนี้ กรุณาตรวจในฐานข้อมูลก่อน",
          },
          { status: 409 }
        );
      default:
        return NextResponse.json({ error: r.error }, { status: 400 });
    }
  }

  if (!r?.unchanged) {
    const before = r?.old_lens_name
      ? `${r.old_lens_name} x${r.old_lens_qty ?? 0} (฿${money(r.old_lens_price ?? 0)})`
      : "ไม่มีเลนส์";
    const after = r?.lens_name
      ? `${r.lens_name} x${r.lens_qty ?? 0} (฿${money(r.lens_price ?? 0)})`
      : "ไม่มีเลนส์";

    await logAdminAction({
      username: String(admin.payload.username ?? ""),
      action: "แก้ไขเลนส์ของการจองที่ยืนยันแล้ว",
      detail:
        `รหัสการจอง ${id} · เลนส์ ${before} → ${after} · ` +
        `ยอดรวม ฿${money(r?.old_total ?? 0)} → ฿${money(r?.total_amount ?? 0)} · ` +
        `จ่ายหน้างาน ฿${money(r?.pay_on_pickup ?? 0)}`,
    });
  }

  return NextResponse.json({ ok: true, result: r });
}
