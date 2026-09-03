-- ให้ผู้ใช้รันเองใน Supabase SQL Editor
-- ⚠️ ต้องรัน "หลัง" scripts/add_session_phone_price_override.sql
--
-- ═══ ระบบ "กันเครื่องชั่วคราว" (hold) ก่อนโชว์เลขบัญชีให้ลูกค้าโอน ═══
--
-- ปัญหาเดิม: สต็อกถูกตัดตอนกด "ฉันโอนแล้ว" เท่านั้น ระหว่างที่ลูกค้ากำลังโอนเงินอยู่ ไม่มีการกันของไว้เลย
-- เวลาคนแย่งกันจอง จึงเกิดเคส "หลายคนโอนเงินพร้อมกัน แต่ได้ของแค่คนเดียว" ที่เหลือต้องขอเงินคืน
--
-- วิธีแก้: ตอนลูกค้ากด "ต่อไป" จากหน้ากรอกข้อมูล (ก่อนเห็นเลขบัญชี) ให้จองที่นั่งไว้เลยแบบมีวันหมดอายุ
-- ถ้าของหมดจะรู้ทันทีตั้งแต่ตอนนั้น (ก่อนเงินออกจากกระเป๋า) ถ้ายังมีของ = เห็นเลขบัญชี = ได้ของแน่นอน
--
-- ไม่ต้องมี cron job คอยล้างของค้าง เพราะทุก query ที่นับสต็อกในระบบกรอง pending_expires_at อยู่แล้ว
-- พอหมดเวลา ระบบจะเลิกนับเป็นสต็อกให้เองอัตโนมัติ

-- ═══════════════ 1) สร้าง/ต่ออายุการกันเครื่อง ═══════════════
-- คืน jsonb: { ok:true, booking_id, expires_at } หรือ { error:'...' }
--
-- กติกา: 1 คนกันได้ทีละ 1 รายการเท่านั้น (กดใหม่ = ทิ้งอันเก่าแล้วกันอันใหม่แทน)
-- กันคนกดรัวๆ ไล่กันเครื่องทุกรุ่นจนคนอื่นจองไม่ได้

create or replace function public.create_booking_hold(
  p_user_id uuid,
  p_session_id uuid,
  p_phone_id uuid,
  p_qty integer,
  p_lens_id uuid,
  p_lens_qty integer,
  p_renter_name text,
  p_renter_phone text,
  p_total_amount numeric,
  p_deposit_amount numeric,
  p_hold_seconds integer default 420   -- 7 นาที (เผื่อไว้มากกว่าเวลาหน้าโอนเงิน 5 นาที)
)
returns jsonb
language plpgsql
as $function$
declare
  v_phone_quota    integer;
  v_phone_booked   integer;
  v_lens_quota     integer;
  v_lens_booked    integer;
  v_expires_at     timestamptz;
  v_booking_id     uuid;
  v_ref            text;
begin
  if p_qty is null or p_qty < 1 then
    return jsonb_build_object('error', 'INVALID_QTY');
  end if;

  -- ล็อกต่อ user_id กันยิงพร้อมกันหลาย request แล้วกันของซ้อนกันเอง
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  -- ทิ้งของที่คนนี้กันไว้ก่อนหน้า (ยังไม่ได้แนบสลิป) — กันไว้ได้ทีละ 1 รายการเท่านั้น
  delete from public.bookings
  where user_id = p_user_id
    and status = 'pending'
    and slip_url is null
    and pending_expires_at is not null;

  -- ── เช็คสต็อกมือถือ (ล็อกแถวโควต้าของรอบนี้ไว้ก่อน) ──
  select qty into v_phone_quota
  from public.session_phone_inventory
  where session_id = p_session_id and phone_id = p_phone_id
  for update;

  if v_phone_quota is null then
    return jsonb_build_object('error', 'PHONE_NOT_CONFIGURED_FOR_SESSION');
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
    return jsonb_build_object('error', 'SOLD_OUT_PHONE');
  end if;

  -- ── เช็คสต็อกเลนส์ (ถ้าเลือกมาด้วย) ──
  if p_lens_id is not null and p_lens_qty > 0 then
    select qty into v_lens_quota
    from public.session_lens_inventory
    where session_id = p_session_id and lens_id = p_lens_id
    for update;

    if v_lens_quota is null then
      return jsonb_build_object('error', 'LENS_NOT_CONFIGURED_FOR_SESSION');
    end if;

    select coalesce(sum(lens_qty), 0) into v_lens_booked
    from public.bookings
    where lens_id = p_lens_id
      and session_id = p_session_id
      and (
        status = 'confirmed'
        or (status = 'pending' and (pending_expires_at is null or pending_expires_at > now()))
      );

    if v_lens_booked + p_lens_qty > v_lens_quota then
      return jsonb_build_object('error', 'SOLD_OUT_LENS');
    end if;
  end if;

  -- ── จำกัดจำนวน "รายการที่โอนแล้วจริง" ที่ยังรอแอดมินตรวจ (ไม่นับของที่แค่กันไว้) ──
  if (
    select count(*) from public.bookings
    where user_id = p_user_id and status = 'pending' and slip_url is not null
  ) >= 3 then
    return jsonb_build_object('error', 'TOO_MANY_PENDING');
  end if;

  v_expires_at := now() + make_interval(secs => greatest(60, coalesce(p_hold_seconds, 420)));
  v_ref := 'BK' || to_char(now(), 'YYMMDD') || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

  insert into public.bookings (
    user_id, session_id, phone_id, qty, lens_id, lens_qty,
    renter_name, renter_phone, total_amount, deposit_amount,
    slip_url, ref_number, status, pending_expires_at
  ) values (
    p_user_id, p_session_id, p_phone_id, p_qty, p_lens_id, coalesce(p_lens_qty, 0),
    p_renter_name, p_renter_phone, round(p_total_amount)::integer,
    case when p_deposit_amount is null then null else round(p_deposit_amount)::integer end,
    null, v_ref, 'pending', v_expires_at
  )
  returning id into v_booking_id;

  return jsonb_build_object('ok', true, 'booking_id', v_booking_id, 'ref_number', v_ref, 'expires_at', v_expires_at);
end;
$function$;

revoke execute on function public.create_booking_hold(uuid, uuid, uuid, integer, uuid, integer, text, text, numeric, numeric, integer) from PUBLIC, anon, authenticated;

-- ═══════════════ 2) คืนของที่กันไว้ (ตอนลูกค้ากดย้อนกลับ/ออกจากขั้นตอน) ═══════════════

create or replace function public.release_booking_hold(p_user_id uuid)
returns jsonb
language plpgsql
as $function$
declare
  v_deleted integer;
begin
  delete from public.bookings
  where user_id = p_user_id
    and status = 'pending'
    and slip_url is null
    and pending_expires_at is not null;
  get diagnostics v_deleted = row_count;
  return jsonb_build_object('ok', true, 'released', v_deleted);
end;
$function$;

revoke execute on function public.release_booking_hold(uuid) from PUBLIC, anon, authenticated;

-- ═══════════════ 3) แนบสลิป = เปลี่ยนของที่กันไว้ให้เป็นการจองจริง ═══════════════
-- ถ้ายังมี hold อยู่ → เติมสลิปลงแถวเดิม แล้วล้างวันหมดอายุ (กลายเป็นการจองถาวร)
-- ถ้า hold หมดอายุ/หายไปแล้ว → ยังเช็คสต็อกแล้วสร้างใหม่ให้เหมือนเดิม (ถ้าของยังเหลือ)
-- ทำให้ลูกค้าที่โอนช้าไปนิดหน่อยยังจองได้ ถ้าของยังไม่หมด

create or replace function public.finalize_booking_with_slip(
  p_user_id uuid,
  p_session_id uuid,
  p_phone_id uuid,
  p_qty integer,
  p_lens_id uuid,
  p_lens_qty integer,
  p_renter_name text,
  p_renter_phone text,
  p_total_amount numeric,
  p_slip_url text,
  p_deposit_amount numeric default null
)
returns table(booking_id uuid, ref_number text)
language plpgsql
as $function$
declare
  v_hold_id        uuid;
  v_hold_ref       text;
  v_hold_qty       integer;
  v_hold_lens_id   uuid;
  v_hold_lens_qty  integer;
  v_phone_quota    integer;
  v_phone_booked   integer;
  v_lens_quota     integer;
  v_lens_booked    integer;
  v_booking_id     uuid;
  v_ref            text;
begin
  if p_qty is null or p_qty < 1 then
    raise exception 'INVALID_QTY';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  -- ── มีของที่กันไว้อยู่ไหม (ตรงรอบ+รุ่น และยังไม่หมดอายุ) ──
  -- ⚠️ ต้องใส่ alias (b.) ทุกคอลัมน์ เพราะฟังก์ชันนี้ประกาศ RETURNS TABLE(booking_id, ref_number)
  -- ชื่อ ref_number จึงชนกันระหว่าง "คอลัมน์ในตาราง" กับ "ตัวแปรผลลัพธ์ของฟังก์ชัน"
  -- ถ้าไม่ใส่ alias Postgres จะฟ้อง: column reference "ref_number" is ambiguous
  select b.id, b.ref_number, b.qty, b.lens_id, b.lens_qty
    into v_hold_id, v_hold_ref, v_hold_qty, v_hold_lens_id, v_hold_lens_qty
  from public.bookings b
  where b.user_id = p_user_id
    and b.session_id = p_session_id
    and b.phone_id = p_phone_id
    and b.status = 'pending'
    and b.slip_url is null
    and b.pending_expires_at is not null
    and b.pending_expires_at > now()
  order by b.pending_expires_at desc
  limit 1
  for update;

  if v_hold_id is not null then
    -- ⚠️ ของที่กันไว้ "กันไว้เท่าที่ขอตอนกันเท่านั้น" ห้ามเขียนทับจำนวนด้วยค่าใหม่จากคำขอ
    -- ไม่งั้นจะกันไว้ 1 เครื่องแล้วยิงยืนยัน 10 เครื่องได้ โดยไม่ผ่านการตรวจสต็อกเลย
    -- (หน้าเว็บจำกัดตัวเลือกไว้ก็จริง แต่ endpoint นี้ยิงตรงได้ จึงต้องกันที่ชั้นนี้)
    -- ถ้าจำนวน/เลนส์ที่ส่งมาไม่ตรงกับที่กันไว้ ให้ปฏิเสธไปเลย
    if p_qty is distinct from v_hold_qty
       or p_lens_id is distinct from v_hold_lens_id
       or coalesce(p_lens_qty, 0) is distinct from coalesce(v_hold_lens_qty, 0) then
      raise exception 'HOLD_MISMATCH';
    end if;

    -- แก้ได้เฉพาะข้อมูลที่ไม่กระทบสต็อก (สลิป ชื่อ เบอร์ ยอดเงิน)
    update public.bookings
    set slip_url = p_slip_url,
        pending_expires_at = null,
        renter_name = p_renter_name,
        renter_phone = p_renter_phone,
        total_amount = round(p_total_amount)::integer,
        deposit_amount = case when p_deposit_amount is null then null else round(p_deposit_amount)::integer end
    where id = v_hold_id;

    return query select v_hold_id, v_hold_ref;
    return;
  end if;

  -- ── ไม่มีของกันไว้แล้ว (หมดอายุ/เข้ามาตรงๆ) → เช็คสต็อกแล้วสร้างใหม่ตามปกติ ──
  if (
    select count(*) from public.bookings
    where user_id = p_user_id and status = 'pending' and slip_url is not null
  ) >= 3 then
    raise exception 'TOO_MANY_PENDING';
  end if;

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

  if p_lens_id is not null and p_lens_qty > 0 then
    select qty into v_lens_quota
    from public.session_lens_inventory
    where session_id = p_session_id and lens_id = p_lens_id
    for update;

    if v_lens_quota is null then
      raise exception 'LENS_NOT_CONFIGURED_FOR_SESSION';
    end if;

    select coalesce(sum(lens_qty), 0) into v_lens_booked
    from public.bookings
    where lens_id = p_lens_id
      and session_id = p_session_id
      and (
        status = 'confirmed'
        or (status = 'pending' and (pending_expires_at is null or pending_expires_at > now()))
      );

    if v_lens_booked + p_lens_qty > v_lens_quota then
      raise exception 'SOLD_OUT_LENS';
    end if;
  end if;

  v_ref := 'BK' || to_char(now(), 'YYMMDD') || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

  insert into public.bookings (
    user_id, session_id, phone_id, qty, lens_id, lens_qty,
    renter_name, renter_phone, total_amount, deposit_amount, slip_url, ref_number, status
  ) values (
    p_user_id, p_session_id, p_phone_id, p_qty, p_lens_id, coalesce(p_lens_qty, 0),
    p_renter_name, p_renter_phone, round(p_total_amount)::integer,
    case when p_deposit_amount is null then null else round(p_deposit_amount)::integer end,
    p_slip_url, v_ref, 'pending'
  )
  returning id into v_booking_id;

  return query select v_booking_id, v_ref;
end;
$function$;

revoke execute on function public.finalize_booking_with_slip(uuid, uuid, uuid, integer, uuid, integer, text, text, numeric, text, numeric) from PUBLIC, anon, authenticated;

-- ═══════════════ 4) ล้างของที่กันไว้แล้วหมดอายุทิ้ง (ไม่บังคับ) ═══════════════
-- ระบบไม่นับของหมดอายุเป็นสต็อกอยู่แล้ว แถวพวกนี้จึงไม่มีผลอะไร แค่กินที่ในตาราง
-- ถ้าอยากล้างเป็นระยะ เรียกฟังก์ชันนี้ได้ (หรือรันมือใน SQL Editor เป็นครั้งคราว)

create or replace function public.purge_expired_booking_holds()
returns jsonb
language plpgsql
as $function$
declare
  v_deleted integer;
begin
  delete from public.bookings
  where status = 'pending'
    and slip_url is null
    and pending_expires_at is not null
    and pending_expires_at < now() - interval '1 hour';
  get diagnostics v_deleted = row_count;
  return jsonb_build_object('ok', true, 'deleted', v_deleted);
end;
$function$;

revoke execute on function public.purge_expired_booking_holds() from PUBLIC, anon, authenticated;
