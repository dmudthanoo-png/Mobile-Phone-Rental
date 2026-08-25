-- ให้ผู้ใช้รันเองใน Supabase SQL Editor
--
-- แก้ 3 เรื่อง ที่พบจากการตรวจซ้ำหลัง deploy scripts/add_session_lens_quota_and_deposit_amount.sql:
--
-- (1) สคริปต์ backfill เดิมให้ "ทุกรอบในอนาคต" ได้โควต้าเลนส์เท่ากับจำนวนรวมทั้งร้านแยกกันคนละชุด
--     (cross join ตรงๆ ไม่ได้หารกันระหว่างรอบวันเดียวกัน) ถ้าวันเดียวกันมี 2 รอบและเลนส์มี 3 ชิ้น
--     ทั้งสองรอบจะเห็นโควต้า 3 ชิ้นแยกกัน จองรวมกันได้ถึง 6 ชิ้นทั้งที่มีของจริงแค่ 3 — เป็นบั๊ก
--     เดียวกับที่ตั้งใจจะแก้ตั้งแต่แรก แค่ backfill ทำผิดพลาดไปเอง สคริปต์นี้ไล่แก้ข้อมูลที่ backfill
--     ผิดไปแล้วให้ปลอดภัย (คงโควต้าเต็มไว้ที่ "รอบแรกสุดของวันนั้น" เท่านั้น รอบอื่นในวันเดียวกัน
--     ลดเหลือเท่าที่มีคนจองไปแล้วจริง — แอดมินต้องไปจัดสรรโควต้าที่เหลือของวันนั้นเองทีหลัง)
--
-- (2) ตั้งโควต้ามือถือ+เลนส์หลายรายการพร้อมกันไม่ atomic — ถ้ารายการแรกๆสำเร็จแล้วรายการหลังพัง
--     รายการแรกๆจะถูกบันทึกค้างไว้ไม่ rollback เพิ่ม RPC ใหม่ที่ทำทุกรายการในทรานแซกชันเดียว
--     ผิดรายการไหนก็ raise exception ยกเลิกทั้งหมดพร้อมกัน
--
-- (3) จำกัด pending สูงสุด 3 รายการต่อผู้ใช้ ยัง bypass ได้ด้วยการยิง request จองพร้อมกันหลายอัน
--     (เดิมเช็คจำนวนก่อนเรียก RPC เป็นคนละ query แยกกัน ไม่ได้ atomic กับการสร้าง booking จริง)
--     ย้ายการเช็คไปไว้ใน RPC จองจริงเลย พร้อมล็อกด้วย advisory lock ต่อ user_id กันยิงพร้อมกันแซงกัน

-- ═══════════════ (1) แก้ข้อมูลโควต้าเลนส์ที่ backfill ผิดไปแล้ว ═══════════════

with booked as (
  select session_id, lens_id, coalesce(sum(lens_qty), 0) as booked_qty
  from public.bookings
  where lens_id is not null
    and (status = 'confirmed' or (status = 'pending' and (pending_expires_at is null or pending_expires_at > now())))
  group by session_id, lens_id
),
ranked as (
  select
    sli.session_id,
    sli.lens_id,
    row_number() over (
      partition by sli.lens_id, (cs.start_at at time zone 'Asia/Bangkok')::date
      order by cs.start_at asc, sli.session_id asc
    ) as rn
  from public.session_lens_inventory sli
  join public.concert_sessions cs on cs.id = sli.session_id
)
update public.session_lens_inventory sli
set qty = greatest(coalesce(b.booked_qty, 0), 0)
from ranked r
left join booked b on b.session_id = r.session_id and b.lens_id = r.lens_id
where sli.session_id = r.session_id
  and sli.lens_id = r.lens_id
  and r.rn > 1
  and sli.qty <> greatest(coalesce(b.booked_qty, 0), 0);

-- เช็คผลลัพธ์ — ควรไม่มีวันไหนที่ sum(qty) ของเลนส์ตัวเดียวกันเกินจำนวนรวมทั้งร้านแล้ว
select
  l.name,
  (cs.start_at at time zone 'Asia/Bangkok')::date as bangkok_day,
  sum(sli.qty) as allocated_that_day,
  l.qty as total_stock
from public.session_lens_inventory sli
join public.concert_sessions cs on cs.id = sli.session_id
join public.lenses l on l.id = sli.lens_id
group by l.id, l.name, l.qty, (cs.start_at at time zone 'Asia/Bangkok')::date
having sum(sli.qty) > l.qty;
-- ถ้า query ข้างบนคืนแถวมา แปลว่ายังมีวันที่จัดสรรเกินอยู่ (ปกติไม่ควรมีหลังรันสคริปต์นี้แล้ว)

-- ═══════════════ (2) RPC ตั้งโควต้าหลายรายการแบบ atomic ทั้งมือถือ+เลนส์ ═══════════════

create or replace function public.set_session_quota_batch(
  p_session_id uuid,
  p_phone_items jsonb default '[]'::jsonb,
  p_lens_items jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
as $function$
declare
  v_item                jsonb;
  v_phone_id             uuid;
  v_lens_id              uuid;
  v_qty                  integer;
  v_day_start            timestamptz;
  v_day_end              timestamptz;
  v_total_qty            integer;
  v_booked_qty           integer;
  v_allocated_elsewhere  integer;
  v_available            integer;
begin
  select start_at into v_day_start from public.concert_sessions where id = p_session_id;
  if v_day_start is null then
    raise exception 'SESSION_NOT_FOUND';
  end if;
  v_day_start := date_trunc('day', v_day_start at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok';
  v_day_end := v_day_start + interval '1 day';

  for v_item in select * from jsonb_array_elements(coalesce(p_phone_items, '[]'::jsonb))
  loop
    v_phone_id := (v_item->>'phone_id')::uuid;
    v_qty := (v_item->>'qty')::integer;
    if v_qty is null or v_qty < 0 then
      raise exception 'INVALID_QTY: phone_id %', v_phone_id;
    end if;

    select qty into v_total_qty from public.phones where id = v_phone_id for update;
    if v_total_qty is null then
      raise exception 'PHONE_NOT_FOUND: %', v_phone_id;
    end if;

    select coalesce(sum(qty), 0) into v_booked_qty
    from public.bookings
    where session_id = p_session_id and phone_id = v_phone_id
      and (status = 'confirmed' or (status = 'pending' and (pending_expires_at is null or pending_expires_at > now())));

    if v_qty < v_booked_qty then
      raise exception 'QTY_BELOW_BOOKED: phone_id % ต้องไม่ต่ำกว่า % เพราะมีการจองอยู่แล้ว', v_phone_id, v_booked_qty;
    end if;

    select coalesce(sum(spi.qty), 0) into v_allocated_elsewhere
    from public.session_phone_inventory spi
    join public.concert_sessions cs on cs.id = spi.session_id
    where spi.phone_id = v_phone_id
      and spi.session_id <> p_session_id
      and cs.start_at >= v_day_start
      and cs.start_at < v_day_end;

    v_available := v_total_qty - v_allocated_elsewhere;
    if v_qty > v_available then
      raise exception 'QTY_EXCEEDS_STOCK: phone_id % ตั้งได้สูงสุด % (มีรอบอื่นวันเดียวกันจัดสรรไปแล้ว % จากทั้งหมด %)',
        v_phone_id, v_available, v_allocated_elsewhere, v_total_qty;
    end if;

    insert into public.session_phone_inventory (session_id, phone_id, qty)
    values (p_session_id, v_phone_id, v_qty)
    on conflict (session_id, phone_id) do update set qty = excluded.qty;
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p_lens_items, '[]'::jsonb))
  loop
    v_lens_id := (v_item->>'lens_id')::uuid;
    v_qty := (v_item->>'qty')::integer;
    if v_qty is null or v_qty < 0 then
      raise exception 'INVALID_QTY: lens_id %', v_lens_id;
    end if;

    select qty into v_total_qty from public.lenses where id = v_lens_id for update;
    if v_total_qty is null then
      raise exception 'LENS_NOT_FOUND: %', v_lens_id;
    end if;

    select coalesce(sum(lens_qty), 0) into v_booked_qty
    from public.bookings
    where session_id = p_session_id and lens_id = v_lens_id
      and (status = 'confirmed' or (status = 'pending' and (pending_expires_at is null or pending_expires_at > now())));

    if v_qty < v_booked_qty then
      raise exception 'QTY_BELOW_BOOKED: lens_id % ต้องไม่ต่ำกว่า % เพราะมีการจองอยู่แล้ว', v_lens_id, v_booked_qty;
    end if;

    select coalesce(sum(sli.qty), 0) into v_allocated_elsewhere
    from public.session_lens_inventory sli
    join public.concert_sessions cs on cs.id = sli.session_id
    where sli.lens_id = v_lens_id
      and sli.session_id <> p_session_id
      and cs.start_at >= v_day_start
      and cs.start_at < v_day_end;

    v_available := v_total_qty - v_allocated_elsewhere;
    if v_qty > v_available then
      raise exception 'QTY_EXCEEDS_STOCK: lens_id % ตั้งได้สูงสุด % (มีรอบอื่นวันเดียวกันจัดสรรไปแล้ว % จากทั้งหมด %)',
        v_lens_id, v_available, v_allocated_elsewhere, v_total_qty;
    end if;

    insert into public.session_lens_inventory (session_id, lens_id, qty)
    values (p_session_id, v_lens_id, v_qty)
    on conflict (session_id, lens_id) do update set qty = excluded.qty;
  end loop;

  return jsonb_build_object('ok', true);
end;
$function$;

revoke execute on function public.set_session_quota_batch(uuid, jsonb, jsonb) from PUBLIC, anon, authenticated;

-- ═══════════════ (3) กันจอง bypass limit 3 รายการต่อคนด้วยการยิงพร้อมกัน ═══════════════
-- ย้ายการเช็ค pending limit เข้าไปในฟังก์ชันจองจริงเลย พร้อม advisory lock ต่อ user_id
-- (ฝั่ง route.ts ยังมีการเช็คก่อนเรียก RPC อยู่เหมือนเดิมเพื่อ UX ที่เร็ว แต่ตัวที่กันได้จริง 100% คือในนี้)

create or replace function public.create_pending_booking_if_available_v2(
  p_user_id uuid, p_session_id uuid, p_phone_id uuid, p_qty integer, p_lens_id uuid, p_lens_qty integer,
  p_renter_name text, p_renter_phone text, p_total_amount numeric, p_slip_url text, p_ref_number text,
  p_deposit_amount numeric default null
)
 RETURNS TABLE(booking_id uuid, ref_number text)
 LANGUAGE plpgsql
AS $function$
declare
  v_phone_quota    integer;
  v_phone_booked   integer;
  v_lens_qty_total integer;
  v_lens_booked    integer;
  v_pending_count  integer;
  v_booking_id     uuid;
  v_ref            text;
begin
  if p_qty is null or p_qty < 1 then
    raise exception 'INVALID_QTY';
  end if;

  -- ล็อกต่อ user_id กันยิง request จองพร้อมกันหลายอันแซงกันจนนับ pending ผิด (TOCTOU)
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  select count(*) into v_pending_count
  from public.bookings
  where user_id = p_user_id and status = 'pending';

  if v_pending_count >= 3 then
    raise exception 'TOO_MANY_PENDING';
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

  -- เลนส์ใช้โควต้าต่อรอบเหมือนมือถือ
  if p_lens_id is not null and p_lens_qty > 0 then
    select qty into v_lens_qty_total
    from public.session_lens_inventory
    where session_id = p_session_id and lens_id = p_lens_id
    for update;

    if v_lens_qty_total is null then
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

    if v_lens_booked + p_lens_qty > v_lens_qty_total then
      raise exception 'SOLD_OUT_LENS';
    end if;
  end if;

  v_ref := coalesce(p_ref_number, 'BK' || to_char(now(), 'YYMMDD') || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8)));

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

revoke execute on function public.create_pending_booking_if_available_v2(uuid, uuid, uuid, integer, uuid, integer, text, text, numeric, text, text, numeric) from PUBLIC, anon, authenticated;
