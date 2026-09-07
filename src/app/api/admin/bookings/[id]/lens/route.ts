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
  lenses: { name: string; focal_mm: number | null; price: number | null; active: boolean | null; qty: number | null } | null;
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

  const { data: bkRaw, error: bkErr } = await supabase
    .from("bookings")
    .select(
      "id, session_id, phone_id, status, lens_id, lens_qty, lens_price, total_amount, deposit_amount, " +
      "phones:phone_id ( model_name ), concert_sessions:session_id ( start_at )"
    )
    .eq("id", id)
    .maybeSingle();

  if (bkErr) return NextResponse.json({ error: bkErr.message }, { status: 500 });
  if (!bkRaw) return NextResponse.json({ error: "ไม่พบรายการจองนี้" }, { status: 404 });

  const bk = bkRaw as unknown as {
    id: string; session_id: string | null; phone_id: string | null; status: string | null;
    lens_id: string | null; lens_qty: number | null; lens_price: number | null;
    total_amount: number | null; deposit_amount: number | null;
    phones: { model_name: string } | null;
    concert_sessions: { start_at: string } | null;
  };

  const bookingPayload = {
    id: bk.id,
    status: bk.status,
    phone_model: bk.phones?.model_name ?? null,
    lens_id: bk.lens_id,
    lens_qty: Number(bk.lens_qty ?? 0),
    lens_price: Number(bk.lens_price ?? 0),
    total_amount: Number(bk.total_amount ?? 0),
    deposit_amount: bk.deposit_amount == null ? null : Number(bk.deposit_amount),
  };

  const notEditable = (reason: string) =>
    NextResponse.json(
      { booking: bookingPayload, editable: false, reason, options: [] },
      { headers: { "Cache-Control": "no-store" } }
    );

  // bookings.phone_id เป็น nullable — ถ้าไม่รู้ว่าจองเครื่องไหน จะเช็คความเข้ากันได้ของเลนส์ไม่ได้
  if (!bk.phone_id) {
    return notEditable("รายการนี้ไม่ได้ระบุรุ่นมือถือ จึงตรวจไม่ได้ว่าเลนส์ตัวไหนใช้ได้ แก้เลนส์ผ่านหน้านี้ไม่ได้");
  }

  // bookings.session_id เป็น nullable (รายการเก่าสมัยยังจองเป็น package ไม่มีรอบ)
  // ถ้าปล่อยผ่านไป .eq("session_id", null) จะกลายเป็น session_id=eq.null แล้ว Postgres
  // โยน invalid input syntax for type uuid ออกมาเป็น 500 พร้อม error ดิบ อ่านไม่รู้เรื่อง
  if (!bk.session_id) {
    return notEditable("รายการนี้ไม่ได้ผูกกับรอบการแสดง จึงไม่มีโควต้าเลนส์ให้ตรวจ แก้เลนส์ผ่านหน้านี้ไม่ได้");
  }

  // ── เลนส์ที่ "ใส่กับมือถือรุ่นที่จองไว้ได้" เท่านั้น ──
  // ฝั่งลูกค้า get_session_phones กรอง lens_options ด้วย phone_lenses อยู่แล้ว
  // ถ้าฝั่งแอดมินไม่กรองด้วย จะเสนอเลนส์ที่ใส่กับเครื่องนั้นไม่ได้ให้แอดมินเลือก
  const { data: compatRows, error: compatErr } = await supabase
    .from("phone_lenses")
    .select("lens_id")
    .eq("phone_id", bk.phone_id);

  if (compatErr) return NextResponse.json({ error: compatErr.message }, { status: 500 });

  const compatible = new Set((compatRows ?? []).map((r) => r.lens_id));
  if (compatible.size === 0) {
    return notEditable(
      `รุ่น ${bk.phones?.model_name ?? "นี้"} ยังไม่ได้ตั้งว่าใช้เลนส์ตัวไหนได้ — ` +
      "ไปผูกเลนส์เข้ากับรุ่นนี้ในแท็บ 📱 มือถือ ก่อน แล้วกลับมาแก้อีกครั้ง"
    );
  }

  // โควต้าเลนส์ที่แอดมินตั้งไว้ให้รอบนี้ (เฉพาะเลนส์ที่เข้ากับเครื่องนี้)
  const { data: invRows, error: invErr } = await supabase
    .from("session_lens_inventory")
    .select("lens_id, qty, lenses:lens_id ( name, focal_mm, price, active, qty )")
    .eq("session_id", bk.session_id)
    .in("lens_id", Array.from(compatible));

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

  // ── ยอดจัดสรรระดับ "วันตามเวลาไทย" ──
  // เลนส์เป็นของจริงชิ้นเดียวกัน ใช้ร่วมกันทุกรอบ/ทุกคอนเสิร์ตในวันเดียวกัน
  // เพดาน "รวมทุกรอบในวันนั้น ≤ lenses.qty" ถูกบังคับตอนตั้งโควต้าแล้ว
  // (set_session_quota_batch → QTY_EXCEEDS_STOCK) แต่แอดมินต้องเห็นตัวเลขนี้
  // เพื่อรู้ว่าถ้าโควต้ารอบนี้ไม่พอ ยังไปเพิ่มโควต้าได้อีกกี่ชิ้นก่อนชนสต็อกจริง
  const dayAllocByLens = new Map<string, number>();
  const startAt = bk.concert_sessions?.start_at ?? null;
  if (startAt) {
    // ขอบเขตวันคิดแบบเดียวกับ SQL: date_trunc('day', ts at time zone 'Asia/Bangkok')
    // Asia/Bangkok ไม่มี DST (คงที่ +07:00) จึงบวก 24 ชม.ได้ตรงเสมอ
    const dayKey = new Date(startAt).toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
    const dayStart = new Date(`${dayKey}T00:00:00+07:00`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const { data: daySessions, error: dsErr } = await supabase
      .from("concert_sessions")
      .select("id")
      .gte("start_at", dayStart.toISOString())
      .lt("start_at", dayEnd.toISOString());

    if (dsErr) return NextResponse.json({ error: dsErr.message }, { status: 500 });

    const dayIds = (daySessions ?? []).map((s) => s.id);
    if (dayIds.length > 0) {
      const { data: dayInv, error: diErr } = await supabase
        .from("session_lens_inventory")
        .select("lens_id, qty")
        .in("session_id", dayIds)
        .in("lens_id", Array.from(compatible));

      if (diErr) return NextResponse.json({ error: diErr.message }, { status: 500 });

      for (const row of dayInv ?? []) {
        dayAllocByLens.set(row.lens_id, (dayAllocByLens.get(row.lens_id) ?? 0) + Number(row.qty ?? 0));
      }
    }
  }

  const options = ((invRows ?? []) as unknown as InvRow[])
    .filter((r) => r.lenses)
    .map((r) => {
      const quota = Number(r.qty ?? 0);
      const booked = bookedByLens.get(r.lens_id) ?? 0;
      const totalStock = Number(r.lenses!.qty ?? 0);
      const dayAllocated = dayAllocByLens.get(r.lens_id) ?? 0;
      return {
        lens_id: r.lens_id,
        name: r.lenses!.name,
        focal_mm: r.lenses!.focal_mm,
        price: Number(r.lenses!.price ?? 0),
        active: r.lenses!.active !== false,
        quota,
        booked,
        // เหลือเท่าไหร่ถ้าจะย้ายรายการนี้มาใส่เลนส์ตัวนี้ (จากโควต้าของรอบนี้)
        available: Math.max(0, quota - booked),
        // ── ระดับวัน ──
        total_stock: totalStock,                                          // เลนส์จริงที่ร้านมี
        day_allocated: dayAllocated,                                      // แจกให้ทุกรอบในวันนั้นรวมกัน
        day_free: Math.max(0, totalStock - dayAllocated),                 // ยังเพิ่มโควต้าได้อีกกี่ชิ้น
      };
    })
    .sort((a, b) => (a.focal_mm ?? 0) - (b.focal_mm ?? 0));

  return NextResponse.json(
    {
      booking: bookingPayload,
      // แก้ได้เฉพาะรายการที่ยืนยันแล้ว (รายการ pending ให้ปฏิเสธแล้วให้ลูกค้าจองใหม่)
      editable: bk.status === "confirmed",
      session_day: startAt
        ? new Date(startAt).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "medium" })
        : null,
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
    total_stock?: number;
    day_allocated?: number;
    day_free?: number;
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
      case "NO_PHONE":
        return NextResponse.json(
          { error: "รายการนี้ไม่ได้ระบุรุ่นมือถือ จึงตรวจไม่ได้ว่าเลนส์ตัวไหนใช้ได้" },
          { status: 409 }
        );
      case "LENS_NOT_COMPATIBLE":
        return NextResponse.json(
          { error: `เลนส์ "${r.lens_name ?? "-"}" ใส่กับมือถือรุ่นที่จองไว้ไม่ได้ — ถ้าใส่ได้จริง ให้ไปผูกเลนส์เข้ากับรุ่นนี้ในแท็บมือถือก่อน` },
          { status: 409 }
        );
      case "LENS_INACTIVE":
        return NextResponse.json(
          { error: `เลนส์ "${r.lens_name ?? "-"}" ถูกปิดใช้งานอยู่ จึงเอามาผูกใหม่ไม่ได้` },
          { status: 409 }
        );
      case "LENS_NOT_CONFIGURED_FOR_SESSION":
        return NextResponse.json(
          {
            error: `รอบนี้ยังไม่ได้ตั้งโควต้าเลนส์ "${r.lens_name ?? "-"}" ไว้ — ไปตั้งโควต้าเลนส์ของรอบก่อน แล้วกลับมาแก้อีกครั้ง`,
          },
          { status: 400 }
        );
      case "SOLD_OUT_LENS": {
        const dayHint = (r.day_free ?? 0) > 0
          ? ` · วันนั้นแจกให้ทุกรอบไปแล้ว ${r.day_allocated ?? 0}/${r.total_stock ?? 0} ชิ้น ยังเพิ่มโควต้ารอบนี้ได้อีก ${r.day_free} ชิ้น`
          : ` · วันนั้นแจกเลนส์จริงหมดแล้ว (${r.day_allocated ?? 0}/${r.total_stock ?? 0} ชิ้น) เพิ่มโควต้าไม่ได้อีก`;
        return NextResponse.json(
          {
            error:
              `โควต้าเลนส์ "${r.lens_name ?? "-"}" ของรอบนี้ไม่พอ: ตั้งไว้ ${r.quota ?? 0} ชิ้น ` +
              `ถูกจองไปแล้ว ${r.booked ?? 0} ชิ้น เหลือ ${r.available ?? 0} ชิ้น แต่ขอ ${r.requested ?? 0} ชิ้น` +
              dayHint,
          },
          { status: 409 }
        );
      }
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
