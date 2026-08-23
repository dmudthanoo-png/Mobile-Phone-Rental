-- ให้ผู้ใช้รันเองใน Supabase SQL Editor
-- แก้บั๊ก: reject_booking_and_restore บวก phones.qty เพิ่มทุกครั้งที่ปฏิเสธการจอง
-- ทั้งที่ create_pending_booking_if_available_v2 ไม่เคยหักลบ phones.qty ตอนสร้าง booking เลย
-- (คำนวณ "คงเหลือ" แบบสดจากการนับ booking ที่ status เป็น confirmed/pending ทุกครั้งอยู่แล้ว)
-- ผลคือทุกครั้งที่ปฏิเสธการจอง phones.qty จะถูกบวกเพิ่มถาวรทีละ 1 แบบผิดๆ

-- ═══════════════════════════════════════════════════════════════
-- 1) แก้ reject_booking_and_restore — เอาการบวก qty ที่ผิดออก
--    (แค่เปลี่ยนสถานะเป็น rejected ก็พอ ไม่ต้องคืนสต็อกเพราะไม่เคยถูกหักไป)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.reject_booking_and_restore(p_booking_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
begin
  update bookings
  set status = 'rejected'
  where id = p_booking_id
    and status = 'pending';

  if not found then
    raise exception 'NOT_PENDING';
  end if;
end;
$function$;

-- ═══════════════════════════════════════════════════════════════
-- 2) เสริมความแข็งแรงให้ create_pending_booking_if_available_v2
--    เพิ่มการกรอง pending ที่หมดอายุออกจากการนับ (กันเผื่อมี booking เก่า
--    ที่หลงเหลือ pending_expires_at ค้างอยู่จาก endpoint เก่าที่ถูกลบไปแล้ว)
--    ไม่ได้เปลี่ยน logic อื่นเลย ยัง check stock จาก phones.qty เหมือนเดิม
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.create_pending_booking_if_available_v2(p_user_id uuid, p_session_id uuid, p_phone_id uuid, p_qty integer, p_lens_id uuid, p_lens_qty integer, p_renter_name text, p_renter_phone text, p_total_amount numeric, p_slip_url text, p_ref_number text)
 RETURNS TABLE(booking_id uuid, ref_number text)
 LANGUAGE plpgsql
AS $function$
declare
  v_phone_qty      integer;
  v_phone_booked   integer;
  v_lens_qty_total integer;
  v_lens_booked    integer;
  v_booking_id     uuid;
  v_ref            text;
begin
  if p_qty is null or p_qty < 1 then
    raise exception 'INVALID_QTY';
  end if;

  -- ล็อกแถวมือถือกันจองพร้อมกันเกิน stock
  select qty into v_phone_qty from public.phones where id = p_phone_id for update;
  if v_phone_qty is null then
    raise exception 'PHONE_NOT_FOUND';
  end if;

  -- นับเฉพาะที่จองไว้ "รอบเดียวกัน" (session_id เดียวกัน) และยังไม่หมดอายุ
  select coalesce(sum(qty), 0) into v_phone_booked
  from public.bookings
  where phone_id = p_phone_id
    and session_id = p_session_id
    and (
      status = 'confirmed'
      or (status = 'pending' and (pending_expires_at is null or pending_expires_at > now()))
    );

  if v_phone_booked + p_qty > v_phone_qty then
    raise exception 'SOLD_OUT_PHONE';
  end if;

  -- ถ้าเลือกเลนส์ ให้ล็อกและเช็ค stock เลนส์ด้วย (สโคปตาม session เดียวกัน)
  if p_lens_id is not null and p_lens_qty > 0 then
    select qty into v_lens_qty_total from public.lenses where id = p_lens_id for update;
    if v_lens_qty_total is null then
      raise exception 'LENS_NOT_FOUND';
    end if;

    select coalesce(sum(lens_qty), 0) into v_lens_booked
    from public.bookings
    where lens_id = p_lens_id
      and session_id = p_session_id
      and (
        status = 'confirmed'
        or (status = 'pending' and (pending_expires_at is null or pending_expires_at > now()))
      );

    if v_lens_booked + p_lens_qty > v_lens_qty_total then
      raise exception 'SOLD_OUT_LENS';
    end if;
  end if;

  v_ref := coalesce(p_ref_number, 'BK' || to_char(now(), 'YYMMDD') || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8)));

  insert into public.bookings (
    user_id, session_id, phone_id, qty, lens_id, lens_qty,
    renter_name, renter_phone, total_amount, slip_url, ref_number, status
  ) values (
    p_user_id, p_session_id, p_phone_id, p_qty, p_lens_id, coalesce(p_lens_qty, 0),
    p_renter_name, p_renter_phone, round(p_total_amount)::integer, p_slip_url, v_ref, 'pending'
  )
  returning id into v_booking_id;

  return query select v_booking_id, v_ref;
end;
$function$;

-- ═══════════════════════════════════════════════════════════════
-- 3) (แนะนำให้รันดูก่อน — ยังไม่แก้อะไร) ประเมินว่า phones.qty
--    แต่ละรุ่นถูกบั๊กนี้บวกเกินไปเท่าไหร่แล้ว โดยนับจากประวัติ
--    booking ที่เคยถูกปฏิเสธทั้งหมด (ทุกครั้งที่ reject = บวกผิด +1)
--
--    estimated_correct_qty เป็นแค่ "ค่าประมาณ" โดยสมมติว่าไม่เคยมีใคร
--    แก้ phones.qty ด้วยมือเพื่อชดเชยบั๊กนี้มาก่อน — ควรเทียบกับจำนวน
--    เครื่องจริงที่ร้านมีก่อนตัดสินใจว่าจะ UPDATE ค่าไหน
-- ═══════════════════════════════════════════════════════════════
select
  p.id,
  p.model_name,
  p.qty as current_qty,
  coalesce(r.rejected_count, 0) as excess_added_by_bug,
  p.qty - coalesce(r.rejected_count, 0) as estimated_correct_qty
from public.phones p
left join (
  select phone_id, count(*) as rejected_count
  from public.bookings
  where status = 'rejected'
  group by phone_id
) r on r.phone_id = p.id
order by excess_added_by_bug desc;
