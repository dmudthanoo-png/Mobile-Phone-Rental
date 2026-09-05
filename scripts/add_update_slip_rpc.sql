-- ให้ผู้ใช้รันเองใน Supabase SQL Editor
-- ⚠️ ต้องรัน "หลัง" scripts/add_booking_hold.sql
--
-- ═══ ทำให้การ "เปลี่ยนสลิป" ปลอดภัย (เดิมข้ามการตรวจสต็อกทั้งหมด) ═══
--
-- ปัญหาที่พบ 3 ข้อ ใน /api/bookings/update-slip:
--
-- (1) รายการที่ถูกปฏิเสธ (rejected) อัปสลิปใหม่แล้วกลับเป็น pending ได้ทันที "โดยไม่ตรวจสต็อกเลย"
--     เคสจริง: เหลือเครื่องสุดท้าย → แอดมินปฏิเสธ A (สต็อกถูกคืน) → B จองเครื่องนั้นไป
--     → A อัปสลิปใหม่ → A กลับมานับสต็อกอีกครั้ง = มี 2 การจองแย่งเครื่องเดียวกัน
--
-- (2) ถ้าแอดมินกดยืนยันระหว่างที่ลูกค้ากำลังอัปสลิป การเขียนจะดึง confirmed กลับเป็น pending
--     เพราะ optimistic lock เดิมล็อกแค่ slip_update_count ไม่ได้ล็อกสถานะด้วย
--
-- (3) ถ้าเปลี่ยนสลิปทับ "ของที่กันไว้แล้วหมดอายุ" วันหมดอายุเดิมยังค้างอยู่
--     → กลายเป็นการจองที่มีสลิปแล้วแต่ระบบไม่นับเป็นสต็อก และแอดมินกดยืนยันไม่ได้
--
-- แก้โดยย้ายการตรวจ+เขียนมาไว้ในทรานแซกชันเดียวกันทั้งหมด

create or replace function public.update_booking_slip(
  p_booking_id uuid,
  p_user_id uuid,
  p_slip_url text,
  p_expected_update_count integer
)
returns jsonb
language plpgsql
as $function$
declare
  v_status         text;
  v_owner          uuid;
  v_session_id     uuid;
  v_phone_id       uuid;
  v_qty            integer;
  v_lens_id        uuid;
  v_lens_qty       integer;
  v_update_count   integer;
  v_expires_at     timestamptz;
  v_phone_quota    integer;
  v_phone_booked   integer;
  v_lens_quota     integer;
  v_lens_booked    integer;
begin
  -- ล็อกแถวการจองไว้ก่อน กันอ่าน-เขียนสวนกันระหว่างที่แอดมินกำลังยืนยัน
  select b.user_id, b.status, b.session_id, b.phone_id, b.qty, b.lens_id, b.lens_qty,
         coalesce(b.slip_update_count, 0), b.pending_expires_at
    into v_owner, v_status, v_session_id, v_phone_id, v_qty, v_lens_id, v_lens_qty, v_update_count, v_expires_at
  from public.bookings b
  where b.id = p_booking_id
  for update;

  if v_owner is null then
    return jsonb_build_object('error', 'NOT_FOUND');
  end if;
  if v_owner <> p_user_id then
    return jsonb_build_object('error', 'FORBIDDEN');
  end if;

  -- (2) เช็คสถานะ "หลังล็อกแถวแล้ว" — ถ้าแอดมินเพิ่งยืนยัน/ปฏิเสธไปจะเห็นค่าล่าสุดเสมอ
  if v_status not in ('pending', 'rejected') then
    return jsonb_build_object('error', 'CANNOT_UPDATE', 'status', v_status);
  end if;

  -- optimistic lock เดิม กันเปลี่ยนสลิปพร้อมกันจาก 2 ที่แล้วนับซ้ำ
  if v_update_count <> p_expected_update_count then
    return jsonb_build_object('error', 'CONFLICT');
  end if;

  -- (1) ต้องตรวจสต็อกใหม่ทุกกรณีที่ "ตอนนี้ไม่ได้ถูกนับเป็นสต็อก" แล้วกำลังจะกลับมาถูกนับ ได้แก่
  --     (ก) rejected → pending
  --     (ข) pending ที่หมดอายุแล้ว (ของที่กันไว้เกินเวลา) — ยังเป็น pending ก็จริง แต่ทุก query
  --         นับสต็อกกรอง pending_expires_at ทิ้งไปแล้ว จึงไม่ได้กินสต็อกอยู่ ณ ตอนนี้
  --     ⚠️ เดิมตรวจแค่ rejected ทำให้เคสนี้หลุด: A กันเครื่องสุดท้ายไว้จนหมดอายุ → B จองไป
  --        → A แนบสลิปผ่าน update-slip → ข้ามการตรวจ → กลายเป็น 2 รายการแย่งเครื่องเดียว
  if v_status = 'rejected'
     or (v_status = 'pending' and v_expires_at is not null and v_expires_at <= now()) then
    select qty into v_phone_quota
    from public.session_phone_inventory
    where session_id = v_session_id and phone_id = v_phone_id
    for update;

    if v_phone_quota is null then
      return jsonb_build_object('error', 'SOLD_OUT_PHONE');
    end if;

    -- ไม่นับตัวเอง เพราะตอนนี้ยังเป็น rejected (ไม่ได้ถูกนับอยู่แล้ว) แต่กันไว้ให้ชัดเจน
    select coalesce(sum(qty), 0) into v_phone_booked
    from public.bookings
    where phone_id = v_phone_id
      and session_id = v_session_id
      and id <> p_booking_id
      and (
        status = 'confirmed'
        or (status = 'pending' and (pending_expires_at is null or pending_expires_at > now()))
      );

    if v_phone_booked + v_qty > v_phone_quota then
      return jsonb_build_object('error', 'SOLD_OUT_PHONE');
    end if;

    if v_lens_id is not null and coalesce(v_lens_qty, 0) > 0 then
      select qty into v_lens_quota
      from public.session_lens_inventory
      where session_id = v_session_id and lens_id = v_lens_id
      for update;

      if v_lens_quota is null then
        return jsonb_build_object('error', 'SOLD_OUT_LENS');
      end if;

      select coalesce(sum(lens_qty), 0) into v_lens_booked
      from public.bookings
      where lens_id = v_lens_id
        and session_id = v_session_id
        and id <> p_booking_id
        and (
          status = 'confirmed'
          or (status = 'pending' and (pending_expires_at is null or pending_expires_at > now()))
        );

      if v_lens_booked + v_lens_qty > v_lens_quota then
        return jsonb_build_object('error', 'SOLD_OUT_LENS');
      end if;
    end if;
  end if;

  update public.bookings
  set slip_url = p_slip_url,
      status = 'pending',
      -- (3) ล้างวันหมดอายุทิ้งเสมอ — พอมีสลิปแล้วถือเป็นการจองจริง ไม่ใช่ของที่กันไว้ชั่วคราวอีกต่อไป
      pending_expires_at = null,
      slip_update_count = v_update_count + 1,
      last_slip_update_at = now(),
      -- ล้างผลตรวจสลิปใบเก่าทิ้ง ไม่งั้นแอดมินจะเห็นผลของใบเก่าเป็นผลของใบใหม่
      slip_verified = false,
      slip_verify_message = null,
      slip_verify_amount = null,
      slip_verify_ref = null,
      slip_verified_at = null
  where id = p_booking_id;

  return jsonb_build_object('ok', true, 'previous_status', v_status);
end;
$function$;

revoke execute on function public.update_booking_slip(uuid, uuid, text, integer) from PUBLIC, anon, authenticated;
