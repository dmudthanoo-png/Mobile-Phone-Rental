-- ให้ผู้ใช้รันเองใน Supabase SQL Editor
--
-- แก้ 2 เรื่องพร้อมกัน (ทั้งคู่แก้ที่ create_pending_booking_if_available_v2 เหมือนกัน เลยรวมสคริปต์เดียว):
--
-- (1) เลนส์โดนจองเกินจริงข้ามรอบ "วันเดียวกัน" ได้ — เพราะ SQL เดิมเช็คเลนส์กับ "จำนวนรวมทั้งร้าน"
--     (lenses.qty) ตรงๆ ไม่ได้แยกโควต้าต่อรอบเหมือนมือถือ (session_phone_inventory) ทำให้หลายรอบ
--     ในวันเดียวกันแย่งเลนส์ชุดเดียวกันเกินจริงได้ — ย้ายเลนส์มาใช้ระบบโควต้าต่อรอบแบบเดียวกับมือถือ
--
-- (2) แดชบอร์ด "รายได้รวม" นับจาก total_amount ทั้งก้อน (รวมส่วนที่จ่ายวันรับเครื่อง ซึ่งไม่เคยผ่าน
--     แอปเลย) ทำให้เป็นแค่ยอดคาดการณ์ ไม่ใช่เงินที่ได้รับจริง — เพิ่มคอลัมน์ deposit_amount เก็บยอด
--     มัดจำที่โอนจริงแยกไว้ต่างหาก ให้แดชบอร์ดโชว์ยอดที่ยืนยันรับจริงได้ถูกต้อง
--
-- ⚠️ สำคัญ: หลังรัน SQL นี้ รอบไหนที่ยังไม่ได้ตั้งโควต้าเลนส์ตัวใดไว้ จะจองเลนส์ตัวนั้นไม่ได้เลย
-- (ขึ้น error LENS_NOT_CONFIGURED_FOR_SESSION) — สคริปต์นี้ backfill โควต้าเริ่มต้นให้ทุกรอบที่ยัง
-- ไม่ผ่านไปแล้วเท่ากับ "จำนวนรวมทั้งร้าน" ของเลนส์นั้นไว้ก่อน (พฤติกรรมเดิมของระบบก่อนแก้)
-- แอดมินค่อยไปปรับลดให้เหมาะสมทีหลังได้จากหน้าเดียวกับตั้งโควต้ามือถือ

-- ═══════════════ (1) ตาราง + RPC ตั้งโควต้าเลนส์ต่อรอบ ═══════════════

create table if not exists public.session_lens_inventory (
  session_id uuid not null references public.concert_sessions(id) on delete cascade,
  lens_id uuid not null references public.lenses(id) on delete cascade,
  qty integer not null default 0,
  primary key (session_id, lens_id)
);

alter table public.session_lens_inventory enable row level security;
revoke all on table public.session_lens_inventory from public, anon, authenticated;
grant select, insert, update, delete on table public.session_lens_inventory to service_role;

-- backfill: ทุกรอบที่ยังไม่ผ่านไปแล้ว x ทุกเลนส์ที่ active ให้โควต้าเริ่มต้น = จำนวนรวมทั้งร้าน
-- (คงพฤติกรรมเดิมไว้ก่อน ไม่ทำให้จองไม่ได้ทันทีหลัง deploy)
insert into public.session_lens_inventory (session_id, lens_id, qty)
select cs.id, l.id, l.qty
from public.concert_sessions cs
cross join public.lenses l
where cs.start_at >= now()
  and l.active = true
on conflict (session_id, lens_id) do nothing;

create or replace function public.set_session_lens_quota(
  p_session_id uuid,
  p_lens_id uuid,
  p_qty integer
)
returns jsonb
language plpgsql
as $function$
declare
  v_lens_qty           integer;
  v_day_start          timestamptz;
  v_day_end            timestamptz;
  v_booked_qty         integer;
  v_allocated_elsewhere integer;
  v_available          integer;
begin
  if p_qty is null or p_qty < 0 then
    return jsonb_build_object('error', 'qty must be a non-negative integer');
  end if;

  -- ล็อกแถวเลนส์ตัวนี้ไว้ก่อน — กันแอดมินคนอื่นตั้งโควต้าเลนส์ตัวเดียวกัน (รอบไหนก็ตาม) พร้อมกัน
  select qty into v_lens_qty from public.lenses where id = p_lens_id for update;
  if v_lens_qty is null then
    return jsonb_build_object('error', 'ไม่พบเลนส์นี้');
  end if;

  select start_at into v_day_start from public.concert_sessions where id = p_session_id;
  if v_day_start is null then
    return jsonb_build_object('error', 'ไม่พบรอบนี้ หรือยังไม่ได้ตั้งวันเวลา');
  end if;

  v_day_start := date_trunc('day', v_day_start at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok';
  v_day_end := v_day_start + interval '1 day';

  select coalesce(sum(lens_qty), 0) into v_booked_qty
  from public.bookings
  where session_id = p_session_id
    and lens_id = p_lens_id
    and (
      status = 'confirmed'
      or (status = 'pending' and (pending_expires_at is null or pending_expires_at > now()))
    );

  if p_qty < v_booked_qty then
    return jsonb_build_object(
      'error',
      format('ตั้งได้ต่ำสุด %s เพราะมีการจองอยู่แล้ว %s ชิ้น', v_booked_qty, v_booked_qty)
    );
  end if;

  select coalesce(sum(sli.qty), 0) into v_allocated_elsewhere
  from public.session_lens_inventory sli
  join public.concert_sessions cs on cs.id = sli.session_id
  where sli.lens_id = p_lens_id
    and sli.session_id <> p_session_id
    and cs.start_at >= v_day_start
    and cs.start_at < v_day_end;

  v_available := v_lens_qty - v_allocated_elsewhere;
  if p_qty > v_available then
    return jsonb_build_object(
      'error',
      format(
        'ตั้งได้สูงสุด %s เพราะมีรอบอื่นในวันเดียวกันจัดสรรไปแล้ว %s จากทั้งหมด %s',
        v_available, v_allocated_elsewhere, v_lens_qty
      )
    );
  end if;

  insert into public.session_lens_inventory (session_id, lens_id, qty)
  values (p_session_id, p_lens_id, p_qty)
  on conflict (session_id, lens_id) do update set qty = excluded.qty;

  return jsonb_build_object('ok', true);
end;
$function$;

revoke execute on function public.set_session_lens_quota(uuid, uuid, integer) from PUBLIC, anon, authenticated;

-- ═══════════════ (2) คอลัมน์เก็บยอดมัดจำที่โอนจริงแยกจาก total_amount ═══════════════

alter table public.bookings
  add column if not exists deposit_amount integer;

-- ═══════════════ อัปเดต RPC จองจริง: ใช้โควต้าเลนส์ต่อรอบ + เก็บ deposit_amount ═══════════════

drop function if exists public.create_pending_booking_if_available_v2(uuid, uuid, uuid, integer, uuid, integer, text, text, numeric, text, text);

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
  v_booking_id     uuid;
  v_ref            text;
begin
  if p_qty is null or p_qty < 1 then
    raise exception 'INVALID_QTY';
  end if;

  -- ล็อกแถวโควต้าของรอบนี้กันจองพร้อมกันเกิน stock
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

  -- ✅ เลนส์เปลี่ยนมาใช้โควต้าต่อรอบเหมือนมือถือแล้ว (เดิมเช็คกับจำนวนรวมทั้งร้านตรงๆ ทำให้หลายรอบ
  -- วันเดียวกันแย่งเลนส์ชุดเดียวกันเกินจริงได้)
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

-- ═══════════════ อัปเดต RPC ดึงรายการมือถือ+เลนส์: ใช้โควต้าเลนส์ต่อรอบด้วย ═══════════════

create or replace function public.get_session_phones(p_session_id uuid)
returns jsonb
language sql
stable
as $$
  with active_phones as (
    select id, model_name, image_url, price, deposit
    from public.phones
    where active = true
  ),
  session_qty as (
    select spi.phone_id, spi.qty
    from public.session_phone_inventory spi
    where spi.session_id = p_session_id
  ),
  session_lens_qty as (
    select sli.lens_id, sli.qty
    from public.session_lens_inventory sli
    where sli.session_id = p_session_id
  ),
  phone_booked as (
    select b.phone_id, sum(coalesce(b.qty, 1)) as booked_qty
    from public.bookings b
    where b.session_id = p_session_id
      and b.phone_id is not null
      and (
        b.status = 'confirmed'
        or (b.status = 'pending' and (b.pending_expires_at is null or b.pending_expires_at > now()))
      )
    group by b.phone_id
  ),
  lens_booked as (
    select b.lens_id, sum(coalesce(b.lens_qty, 0)) as booked_qty
    from public.bookings b
    where b.session_id = p_session_id
      and b.lens_id is not null
      and (
        b.status = 'confirmed'
        or (b.status = 'pending' and (b.pending_expires_at is null or b.pending_expires_at > now()))
      )
    group by b.lens_id
  ),
  lens_for_phone as (
    select
      pl.phone_id,
      jsonb_agg(
        jsonb_build_object(
          'lens_id', l.id,
          'name', l.name,
          'focal_mm', l.focal_mm,
          'price', l.price,
          'remaining', greatest(0, coalesce(slq.qty, 0) - coalesce(lb.booked_qty, 0))
        )
        order by coalesce(l.focal_mm, 0) asc
      ) as lens_options
    from public.phone_lenses pl
    join public.lenses l on l.id = pl.lens_id and l.active = true
    left join session_lens_qty slq on slq.lens_id = l.id
    left join lens_booked lb on lb.lens_id = l.id
    group by pl.phone_id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'phone_id', p.id,
        'model_name', p.model_name,
        'image_url', p.image_url,
        'price', p.price,
        'deposit', p.deposit,
        'remaining', greatest(0, sq.qty - coalesce(pb.booked_qty, 0)),
        'lens_options', coalesce(lfp.lens_options, '[]'::jsonb)
      )
      order by greatest(0, sq.qty - coalesce(pb.booked_qty, 0)) desc
    ),
    '[]'::jsonb
  )
  from active_phones p
  join session_qty sq on sq.phone_id = p.id
  left join phone_booked pb on pb.phone_id = p.id
  left join lens_for_phone lfp on lfp.phone_id = p.id
$$;

revoke execute on function public.get_session_phones(uuid) from PUBLIC, anon, authenticated;

-- ═══════════════ backfill deposit_amount ย้อนหลังแบบประมาณ (ไม่บังคับ แต่แนะนำ) ═══════════════
-- ยอดเก่าไม่เคยเก็บมัดจำแยกไว้ เลยประมาณจาก "มัดจำปัจจุบันของรุ่นนั้น x จำนวนเครื่อง" แทน
-- (อาจไม่ตรงเป๊ะถ้าเคยเปลี่ยนราคามัดจำมาก่อน แต่ดีกว่าปล่อยเป็น null ทั้งหมด)
update public.bookings b
set deposit_amount = round(p.deposit * b.qty)::integer
from public.phones p
where b.phone_id = p.id
  and b.deposit_amount is null;
