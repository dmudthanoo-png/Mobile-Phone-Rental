-- ให้ผู้ใช้รันเองใน Supabase SQL Editor
-- รวม query 3 อัน (เลนส์ / โควต้ารอบนี้ / ยอดจองแล้ว) ที่หน้าเลือกมือถือต้องรอ
-- ให้เหลือ round-trip เดียวไปกลับระหว่าง server เรากับ Supabase (จากเดิม 2 round-trip)
-- ลด latency เครือข่ายที่ต้องเสียซ้ำ ไม่เปลี่ยน logic การคำนวณสต็อก/เลนส์เลยแม้แต่น้อย

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
          'remaining', greatest(0, l.qty - coalesce(lb.booked_qty, 0))
        )
        order by coalesce(l.focal_mm, 0) asc
      ) as lens_options
    from public.phone_lenses pl
    join public.lenses l on l.id = pl.lens_id and l.active = true
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

-- ปิดสิทธิ์เรียกตรงจาก client เหมือน RPC จองอื่นๆ ในระบบ (เรียกได้แค่ผ่าน service-role key ฝั่ง server เท่านั้น)
revoke execute on function public.get_session_phones(uuid) from PUBLIC, anon, authenticated;
