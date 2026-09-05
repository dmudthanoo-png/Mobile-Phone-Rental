-- ให้ผู้ใช้รันเองใน Supabase SQL Editor
-- ⚠️ ต้องรัน "หลัง" scripts/add_session_phone_price_override.sql และ scripts/add_update_slip_rpc.sql
--
-- ═══ แก้จังหวะล็อกที่ทำให้โควต้าต่ำกว่ายอดจองได้ ═══
--
-- ปัญหา: ตอนแอดมินตั้งโควต้า ฟังก์ชันล็อกแถว public.phones แล้วค่อยนับยอดจอง
-- แต่ตอนลูกค้าเปลี่ยนสลิป (rejected/หมดอายุ → pending) ล็อกแถว session_phone_inventory
-- คนละแถวกัน → ล็อกไม่ชนกัน → ทำงานสวนกันได้:
--
--   1. แอดมินอ่านยอดจอง = 0  (ลูกค้ายังไม่ commit)
--   2. ลูกค้าคืนรายการ 2 เครื่องกลับเป็น pending สำเร็จ
--   3. แอดมินเขียนโควต้า = 1 สำเร็จ  →  โควต้า 1 แต่มีคนจองไปแล้ว 2 เครื่อง
--
-- แก้โดยให้ทั้งสองฝั่ง "ล็อกแถวโควต้าของรอบนั้น (session_phone_inventory) เป็นแถวแรกเสมอ"
-- แล้วค่อยนับยอดจอง ทำให้สองงานนี้ต้องเข้าคิวกันจริงๆ

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
    v_price_override := nullif(v_item->>'price_override', '')::integer;

    if v_qty is null or v_qty < 0 then
      raise exception 'INVALID_QTY: phone_id %', v_phone_id;
    end if;
    if v_price_override is not null and v_price_override < 0 then
      raise exception 'INVALID_PRICE: phone_id % ราคาต้องไม่ติดลบ', v_phone_id;
    end if;

    -- ✅ ล็อกแถวโควต้าของรอบนี้ก่อนเป็นอันดับแรก ให้เป็นแถวเดียวกับที่ฝั่งเปลี่ยนสลิปล็อก
    -- (ถ้ายังไม่มีแถว ให้สร้างแถวเปล่าไว้ก่อนเพื่อให้มีอะไรให้ล็อก)
    insert into public.session_phone_inventory (session_id, phone_id, qty)
    values (p_session_id, v_phone_id, 0)
    on conflict (session_id, phone_id) do nothing;

    perform 1 from public.session_phone_inventory
    where session_id = p_session_id and phone_id = v_phone_id
    for update;

    select qty into v_total_qty from public.phones where id = v_phone_id for update;
    if v_total_qty is null then
      raise exception 'PHONE_NOT_FOUND: %', v_phone_id;
    end if;

    -- นับยอดจอง "หลังจากล็อกแถวโควต้าแล้ว" จึงเห็นผลของธุรกรรมที่ commit ไปก่อนหน้าเสมอ
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

    update public.session_phone_inventory
    set qty = v_qty, price_override = v_price_override
    where session_id = p_session_id and phone_id = v_phone_id;
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p_lens_items, '[]'::jsonb))
  loop
    v_lens_id := (v_item->>'lens_id')::uuid;
    v_qty := (v_item->>'qty')::integer;
    if v_qty is null or v_qty < 0 then
      raise exception 'INVALID_QTY: lens_id %', v_lens_id;
    end if;

    -- ล็อกแถวโควต้าเลนส์ของรอบนี้ก่อนเช่นกัน
    insert into public.session_lens_inventory (session_id, lens_id, qty)
    values (p_session_id, v_lens_id, 0)
    on conflict (session_id, lens_id) do nothing;

    perform 1 from public.session_lens_inventory
    where session_id = p_session_id and lens_id = v_lens_id
    for update;

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

    update public.session_lens_inventory
    set qty = v_qty
    where session_id = p_session_id and lens_id = v_lens_id;
  end loop;

  return jsonb_build_object('ok', true);
end;
$function$;

revoke execute on function public.set_session_quota_batch(uuid, jsonb, jsonb) from PUBLIC, anon, authenticated;
