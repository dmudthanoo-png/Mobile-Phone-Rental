-- ให้ผู้ใช้รันเองใน Supabase SQL Editor
-- ⚠️ ต้องรัน "หลัง" scripts/fix_lens_quota_backfill_and_atomic_batch.sql เท่านั้น
--    (สคริปต์นี้เขียนทับฟังก์ชัน set_session_quota_batch และ get_session_phones ให้รองรับราคาต่อรอบ
--     ถ้ารันสลับลำดับ ตัวเก่าจะทับตัวใหม่แล้วฟีเจอร์ราคาต่อรอบจะหายไป)
--
-- เพิ่มความสามารถ "ตั้งราคาค่าเช่ามือถือแยกรายรอบ" (เผื่อบางคอนเสิร์ตต้องขึ้นราคา)
-- ตั้งที่หน้าเดียวกับตั้งโควต้ามือถือ — ปล่อยว่างไว้ = ใช้ราคาตั้งต้นของรุ่นนั้น (phones.price) เหมือนเดิม
--
-- หมายเหตุ: override เฉพาะ "ค่าเช่า" เท่านั้น ส่วน "มัดจำ" (phones.deposit) ยังใช้ค่าเดิมของรุ่นทุกรอบ
-- เพราะมัดจำคือยอดที่ลูกค้าโอนจริงและระบบตรวจสลิป (SlipOK) ใช้เทียบ — ถ้าจะให้ override ด้วยต้องแก้
-- lib/slipOk.ts ประกอบ ยังไม่ทำในรอบนี้

alter table public.session_phone_inventory
  add column if not exists price_override integer;

-- ═══════════════ get_session_phones: คืนราคาที่ใช้จริงของรอบนั้น ═══════════════

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
    select spi.phone_id, spi.qty, spi.price_override
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
        -- ✅ ราคาที่ใช้จริงของรอบนี้: ถ้าตั้ง override ไว้ใช้อันนั้น ไม่งั้นใช้ราคาตั้งต้นของรุ่น
        'price', coalesce(sq.price_override, p.price),
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

-- ═══════════════ set_session_quota_batch: รับ price_override มาบันทึกด้วย ═══════════════
-- (เหมือนเดิมทุกอย่าง เพิ่มแค่การอ่าน/เขียน price_override ในลูปมือถือ)

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
  v_price_override       integer;
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
    -- ไม่ส่งมา / ส่งมาเป็น null = ใช้ราคาตั้งต้นของรุ่น (เก็บเป็น null)
    v_price_override := nullif(v_item->>'price_override', '')::integer;

    if v_qty is null or v_qty < 0 then
      raise exception 'INVALID_QTY: phone_id %', v_phone_id;
    end if;
    if v_price_override is not null and v_price_override < 0 then
      raise exception 'INVALID_PRICE: phone_id % ราคาต้องไม่ติดลบ', v_phone_id;
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

    insert into public.session_phone_inventory (session_id, phone_id, qty, price_override)
    values (p_session_id, v_phone_id, v_qty, v_price_override)
    on conflict (session_id, phone_id) do update
      set qty = excluded.qty, price_override = excluded.price_override;
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
