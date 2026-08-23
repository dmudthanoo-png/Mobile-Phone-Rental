-- ให้ผู้ใช้รันเองใน Supabase SQL Editor
-- เปลี่ยนระบบเช็คสต็อกมือถือตอนจอง จาก "ใช้จำนวนรวมร้านทุกรอบ" (ทำให้ 2 คอนวันเดียวกัน
-- นับสต็อกซ้อนกันได้) เป็น "ทุกรอบต้องตั้งโควต้าของตัวเองก่อนถึงจะจองได้" โดยระบบจะกันไม่ให้
-- ตั้งโควต้ารวมกันเกินจำนวนที่ร้านมีจริง เฉพาะรอบที่วันที่ตรงกัน (รอบวันอื่นไม่กระทบกัน
-- เพราะเครื่องคืนแล้วใช้ซ้ำได้)
--
-- หลังรัน SQL นี้: รอบไหนที่ยังไม่ได้ตั้งโควต้ามือถือรุ่นใดไว้ รุ่นนั้นจะจองไม่ได้เลย
-- (ขึ้น error PHONE_NOT_CONFIGURED_FOR_SESSION) ต้องไปตั้งโควต้าให้ทุกรอบที่เปิดจองอยู่ก่อน deploy

CREATE OR REPLACE FUNCTION public.create_pending_booking_if_available_v2(p_user_id uuid, p_session_id uuid, p_phone_id uuid, p_qty integer, p_lens_id uuid, p_lens_qty integer, p_renter_name text, p_renter_phone text, p_total_amount numeric, p_slip_url text, p_ref_number text)
 RETURNS TABLE(booking_id uuid, ref_number text)
 LANGUAGE plpgsql
AS $function$
declare
  v_phone_quota    integer;
  v_phone_booked   integer;
  v_lens_qty_total integer;
  v_lens_booked    integer;
  v_booking_id     uuid;
  v_ref            text;
begin
  if p_qty is null or p_qty < 1 then
    raise exception 'INVALID_QTY';
  end if;

  -- ล็อกแถวโควต้าของรอบนี้กันจองพร้อมกันเกิน stock
  -- (เปลี่ยนจาก public.phones เป็น session_phone_inventory — โควต้าเฉพาะรอบ ไม่ใช่จำนวนรวมร้าน)
  select qty into v_phone_quota
  from public.session_phone_inventory
  where session_id = p_session_id and phone_id = p_phone_id
  for update;

  if v_phone_quota is null then
    raise exception 'PHONE_NOT_CONFIGURED_FOR_SESSION';
  end if;

  select coalesce(sum(qty), 0) into v_phone_booked
  from public.bookings
  where phone_id = p_phone_id
    and session_id = p_session_id
    and (
      status = 'confirmed'
      or (status = 'pending' and (pending_expires_at is null or pending_expires_at > now()))
    );

  if v_phone_booked + p_qty > v_phone_quota then
    raise exception 'SOLD_OUT_PHONE';
  end if;

  -- เลนส์ยังใช้ระบบเดิม (จำนวนรวมร้าน ต่อรอบ) — ยังไม่เปลี่ยน เพราะปัญหาที่แก้รอบนี้เจาะจงเรื่องมือถือ
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
