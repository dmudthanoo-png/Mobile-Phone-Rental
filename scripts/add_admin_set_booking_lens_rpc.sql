-- ให้ผู้ใช้รันเองใน Supabase SQL Editor
-- ⚠️ ถ้าเคยรันไฟล์นี้เวอร์ชันแรกไปแล้ว ให้รันซ้ำ — เวอร์ชันนี้เพิ่มการเช็ค 2 อย่าง
--    (1) เลนส์ต้องใช้กับมือถือที่จองไว้ได้จริง (phone_lenses)
--    (2) เลนส์ที่ปิดใช้งานแล้ว ห้ามเอามาผูกใหม่
-- ═══════════════════════════════════════════════════════════════
-- admin_set_booking_lens — ให้แอดมินเพิ่ม/เปลี่ยน/ลบเลนส์ของ "การจองที่ยืนยันแล้ว"
--
-- ใช้ตอนลูกค้าลืมเลือกเลนส์ (หรือเลือกผิดรุ่น) แล้วแอดมินกดยืนยันการจองไปแล้ว
-- เดิมแก้ไม่ได้เลย ทางเดียวคือปฏิเสธให้จองใหม่ ซึ่งพังเพราะ
-- bookings_slip_verify_ref_unique_when_verified จับเลขอ้างอิงสลิปใบเดิมค้างไว้
-- (การปฏิเสธไม่ล้าง slip_verified) → ลูกค้าอัปสลิปใบเดิมกับรายการใหม่ไม่ได้ ต้องโอนใหม่ทั้งก้อน
--
-- ⚠️ จำกัดไว้เฉพาะ status = 'confirmed' โดยเจตนา
--    รายการ pending คือรายการที่ยังรอตรวจสลิป total_amount/deposit_amount ของมัน
--    เป็นยอดที่บอกลูกค้าให้โอน ถ้าแอดมินไปขยับกลางทาง การตรวจสลิปจะเทียบยอดไม่ตรงทันที
--    รายการที่ยังไม่ยืนยัน ให้ปฏิเสธแล้วให้ลูกค้าจองใหม่ตามปกติ (สลิปยังไม่ถูกล็อก)
--
-- เรื่องเงิน: ขยับ total_amount ตามค่าเลนส์ แต่ไม่แตะ deposit_amount (โอนมาแล้ว)
--            → ผลต่างไปโผล่ที่ "ยอดจ่ายหน้างาน" ลูกค้าไม่ต้องโอนเพิ่ม/ไม่ต้องคืนเงิน
--
-- จังหวะล็อก: bookings row → session_lens_inventory
--   ลำดับเดียวกับ update_booking_slip และ set_session_quota_batch ไม่เคยล็อกแถว bookings
--   จึงไม่มีวงจรรอกันข้ามฟังก์ชัน (ดู scripts/fix_quota_lock_ordering.sql)
--
-- เรื่องสต็อก: เช็คกับ session_lens_inventory.qty ของรอบนั้นรอบเดียวพอ
--   เพราะเพดาน "รวมทุกรอบในวันเดียวกันต้องไม่เกิน lenses.qty" ถูกบังคับตอน *ตั้งโควต้า*
--   ไปแล้วใน set_session_quota_batch (QTY_EXCEEDS_STOCK) และตอนย้ายวันใน move_concert_session
--   ฟังก์ชันนี้ไม่ได้เพิ่มโควต้า แค่ใช้โควต้าที่ตั้งไว้แล้ว จึงไม่ทำให้เพดานรายวันพัง
--   แต่ตอนโควต้าไม่พอ จะคืนตัวเลขระดับวันกลับไปด้วย ให้แอดมินรู้ว่าเพิ่มโควต้าได้อีกไหม
-- ═══════════════════════════════════════════════════════════════

create or replace function public.admin_set_booking_lens(
  p_booking_id uuid,
  p_lens_id    uuid,     -- null = ลบเลนส์ออกจากการจอง
  p_lens_qty   integer   -- 0 / null = ลบเลนส์ออกจากการจอง
)
returns jsonb
language plpgsql
as $function$
declare
  v_session_id     uuid;
  v_phone_id       uuid;
  v_status         text;
  v_old_lens_id    uuid;
  v_old_lens_qty   integer;
  v_old_lens_price integer;
  v_total          integer;
  v_deposit        integer;

  v_target_lens    uuid;
  v_target_qty     integer;
  v_lens_price     numeric;
  v_lens_name      text;
  v_lens_active    boolean;
  v_old_lens_name  text;
  v_quota          integer;
  v_booked         integer;
  v_new_lens_price integer;
  v_new_total      integer;

  v_day_start      timestamptz;
  v_day_end        timestamptz;
  v_total_stock    integer;
  v_day_allocated  integer;
begin
  -- ── ทำค่าที่รับเข้ามาให้เป็นรูปแบบเดียว: ไม่มีเลนส์ = (null, 0) เสมอ ──
  v_target_qty := coalesce(p_lens_qty, 0);
  if p_lens_id is null or v_target_qty <= 0 then
    v_target_lens := null;
    v_target_qty  := 0;
  else
    v_target_lens := p_lens_id;
  end if;

  if v_target_qty > 20 then
    return jsonb_build_object('error', 'LENS_QTY_TOO_LARGE');
  end if;

  -- ── (1) ล็อกแถวการจองไว้ก่อน กันแอดมิน 2 คนแก้รายการเดียวกันพร้อมกัน ──
  select b.session_id, b.phone_id, b.status, b.lens_id, coalesce(b.lens_qty, 0),
         coalesce(b.lens_price, 0), coalesce(b.total_amount, 0), b.deposit_amount
    into v_session_id, v_phone_id, v_status, v_old_lens_id, v_old_lens_qty,
         v_old_lens_price, v_total, v_deposit
  from public.bookings b
  where b.id = p_booking_id
  for update;

  if not found then
    return jsonb_build_object('error', 'NOT_FOUND');
  end if;

  -- coalesce กัน status เป็น null แล้ว comparison กลายเป็น NULL ทำให้หลุดด่านนี้ไป
  if coalesce(v_status, '') <> 'confirmed' then
    return jsonb_build_object('error', 'NOT_CONFIRMED', 'status', v_status);
  end if;

  -- ไม่มีอะไรเปลี่ยน — ตอบสำเร็จไปเลย ไม่ต้องเขียนซ้ำ
  if v_target_lens is not distinct from v_old_lens_id and v_target_qty = v_old_lens_qty then
    return jsonb_build_object(
      'ok', true, 'unchanged', true,
      'lens_qty', v_old_lens_qty, 'lens_price', v_old_lens_price,
      'old_total', v_total, 'total_amount', v_total,
      'deposit_amount', v_deposit,
      'pay_on_pickup', v_total - coalesce(v_deposit, 0)
    );
  end if;

  -- เก็บชื่อเลนส์เดิมไว้เขียน audit log (ดึงก่อนเขียนทับ)
  if v_old_lens_id is not null then
    select l.name into v_old_lens_name from public.lenses l where l.id = v_old_lens_id;
  end if;

  if v_target_lens is not null then
    select l.price, l.name, l.active into v_lens_price, v_lens_name, v_lens_active
    from public.lenses l
    where l.id = v_target_lens;

    if not found then
      return jsonb_build_object('error', 'LENS_NOT_FOUND');
    end if;

    -- ── (2) เลนส์ต้องใช้กับมือถือที่จองไว้ได้จริง ──
    -- ฝั่งลูกค้า get_session_phones กรอง lens_options ด้วย phone_lenses อยู่แล้ว
    -- ถ้าฝั่งแอดมินไม่กรอง จะผูกเลนส์ที่ใส่กับเครื่องนั้นไม่ได้เข้าไปได้ แล้วไปพังหน้างาน
    if v_phone_id is null then
      return jsonb_build_object('error', 'NO_PHONE');
    end if;

    perform 1 from public.phone_lenses pl
    where pl.phone_id = v_phone_id and pl.lens_id = v_target_lens;

    if not found then
      return jsonb_build_object(
        'error', 'LENS_NOT_COMPATIBLE',
        'lens_name', v_lens_name
      );
    end if;

    -- ── (3) เลนส์ที่ปิดใช้งานแล้ว ห้ามผูกใหม่ (แต่ของเดิมที่ผูกไว้แล้ว แก้จำนวน/ถอดออกได้) ──
    if coalesce(v_lens_active, false) = false and v_target_lens is distinct from v_old_lens_id then
      return jsonb_build_object('error', 'LENS_INACTIVE', 'lens_name', v_lens_name);
    end if;

    -- ── (4) ล็อกแถวโควต้าเลนส์ของรอบนี้ แล้วค่อยนับยอดจอง ──
    select sli.qty into v_quota
    from public.session_lens_inventory sli
    where sli.session_id = v_session_id and sli.lens_id = v_target_lens
    for update;

    if not found then
      return jsonb_build_object(
        'error', 'LENS_NOT_CONFIGURED_FOR_SESSION',
        'lens_name', v_lens_name
      );
    end if;

    -- ไม่นับรายการนี้เอง เพราะกำลังจะเขียนค่าใหม่ทับ (ไม่งั้นตอนเพิ่มจำนวนจะนับซ้ำ)
    select coalesce(sum(b.lens_qty), 0) into v_booked
    from public.bookings b
    where b.lens_id = v_target_lens
      and b.session_id = v_session_id
      and b.id <> p_booking_id
      and (
        b.status = 'confirmed'
        or (b.status = 'pending' and (b.pending_expires_at is null or b.pending_expires_at > now()))
      );

    if v_booked + v_target_qty > v_quota then
      -- คิดยอดระดับ "วันตามเวลาไทย" ให้ด้วย เพื่อบอกแอดมินว่ายังเพิ่มโควต้ารอบนี้ได้อีกไหม
      -- (ขอบเขตวันคิดแบบเดียวกับ set_session_quota_batch เป๊ะๆ)
      select date_trunc('day', cs.start_at at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok'
        into v_day_start
      from public.concert_sessions cs where cs.id = v_session_id;
      v_day_end := v_day_start + interval '1 day';

      select l.qty into v_total_stock from public.lenses l where l.id = v_target_lens;

      select coalesce(sum(sli.qty), 0) into v_day_allocated
      from public.session_lens_inventory sli
      join public.concert_sessions cs on cs.id = sli.session_id
      where sli.lens_id = v_target_lens
        and cs.start_at >= v_day_start
        and cs.start_at < v_day_end;

      return jsonb_build_object(
        'error', 'SOLD_OUT_LENS',
        'lens_name', v_lens_name,
        'quota', v_quota,
        'booked', v_booked,
        'requested', v_target_qty,
        'available', greatest(0, v_quota - v_booked),
        -- ตัวเลขระดับวัน: เพิ่มโควต้ารอบนี้ได้อีกกี่ชิ้นก่อนชนสต็อกจริงของร้าน
        'total_stock', v_total_stock,
        'day_allocated', v_day_allocated,
        'day_free', greatest(0, coalesce(v_total_stock, 0) - v_day_allocated)
      );
    end if;

    v_new_lens_price := round(v_lens_price * v_target_qty)::integer;
  else
    v_new_lens_price := 0;
  end if;

  -- ── (5) ขยับยอดรวมด้วย "ผลต่างค่าเลนส์" ไม่คำนวณยอดใหม่ทั้งก้อน ──
  -- ค่ามือถือของรายการนี้อาจมาจาก session_phone_inventory.price_override ที่แอดมิน
  -- ตั้งไว้ตอนนั้น และอาจถูกแก้ไปแล้วหลังจากลูกค้าจอง ถ้าคำนวณใหม่ทั้งก้อนจาก
  -- ราคาปัจจุบัน ยอดของลูกค้าจะเปลี่ยนทั้งที่ไม่ได้ตั้งใจแก้ค่ามือถือ
  v_new_total := v_total - v_old_lens_price + v_new_lens_price;

  if v_new_total < 0 then
    return jsonb_build_object('error', 'TOTAL_WOULD_BE_NEGATIVE', 'total_amount', v_new_total);
  end if;

  update public.bookings
  set lens_id      = v_target_lens,
      lens_qty     = v_target_qty,
      add_lens     = (v_target_lens is not null),
      lens_price   = v_new_lens_price,
      total_amount = v_new_total
  where id = p_booking_id;

  return jsonb_build_object(
    'ok', true,
    'unchanged', false,
    'lens_id', v_target_lens,
    'lens_name', v_lens_name,
    'lens_qty', v_target_qty,
    'lens_price', v_new_lens_price,
    'old_lens_name', v_old_lens_name,
    'old_lens_qty', v_old_lens_qty,
    'old_lens_price', v_old_lens_price,
    'old_total', v_total,
    'total_amount', v_new_total,
    'deposit_amount', v_deposit,
    'pay_on_pickup', v_new_total - coalesce(v_deposit, 0)
  );
end;
$function$;

-- เรียกได้จาก service_role (ฝั่ง API แอดมิน) เท่านั้น
revoke execute on function public.admin_set_booking_lens(uuid, uuid, integer) from PUBLIC, anon, authenticated;
