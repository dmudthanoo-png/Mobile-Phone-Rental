-- ให้ผู้ใช้รันเองใน Supabase SQL Editor
-- แก้ race condition ตอนแอดมินตั้งโควต้ามือถือของรอบ: เดิม endpoint อ่าน "จัดสรรไปแล้วเท่าไหร่"
-- แล้วค่อยคำนวณ/เขียนทับแยกกัน 3 คำสั่ง ไม่มี lock เลย ถ้าแอดมิน 2 คนตั้งโควต้ามือถือรุ่นเดียวกัน
-- (คนละรอบ วันเดียวกัน) พร้อมกัน ทั้งคู่จะเห็นเลขเดิม ผ่านการเช็คทั้งคู่ แล้วรวมกันเกินสต็อกจริงได้
--
-- ฟังก์ชันนี้ทำทุกขั้นตอน (เช็คยอดจองเดิม + เช็คโควต้าที่รอบอื่นวันเดียวกันใช้ไปแล้ว + บันทึก)
-- ในทรานแซกชันเดียว โดยล็อกแถว phones ของรุ่นนั้นไว้ก่อน (for update) กันแอดมินคนอื่นตั้งโควต้า
-- มือถือรุ่นเดียวกันพร้อมกันจนรวมกันเกินสต็อกจริง

create or replace function public.set_session_phone_quota(
  p_session_id uuid,
  p_phone_id uuid,
  p_qty integer
)
returns jsonb
language plpgsql
as $function$
declare
  v_phone_qty          integer;
  v_day_start          timestamptz;
  v_day_end            timestamptz;
  v_booked_qty         integer;
  v_allocated_elsewhere integer;
  v_available          integer;
begin
  if p_qty is null or p_qty < 0 then
    return jsonb_build_object('error', 'qty must be a non-negative integer');
  end if;

  -- ล็อกแถวมือถือรุ่นนี้ไว้ก่อน — กันแอดมินคนอื่นตั้งโควต้ารุ่นเดียวกัน (รอบไหนก็ตาม) พร้อมกัน
  select qty into v_phone_qty from public.phones where id = p_phone_id for update;
  if v_phone_qty is null then
    return jsonb_build_object('error', 'ไม่พบมือถือรุ่นนี้');
  end if;

  select start_at into v_day_start from public.concert_sessions where id = p_session_id;
  if v_day_start is null then
    return jsonb_build_object('error', 'ไม่พบรอบนี้ หรือยังไม่ได้ตั้งวันเวลา');
  end if;

  -- ช่วง "วันเดียวกัน" ตามเวลาไทย (UTC+7 ไม่มี DST) — รอบที่วันเดียวกันเท่านั้นถือว่าแย่งสต็อกชุดเดียวกัน
  v_day_start := date_trunc('day', v_day_start at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok';
  v_day_end := v_day_start + interval '1 day';

  select coalesce(sum(qty), 0) into v_booked_qty
  from public.bookings
  where session_id = p_session_id
    and phone_id = p_phone_id
    and (
      status = 'confirmed'
      or (status = 'pending' and (pending_expires_at is null or pending_expires_at > now()))
    );

  if p_qty < v_booked_qty then
    return jsonb_build_object(
      'error',
      format('ตั้งได้ต่ำสุด %s เพราะมีการจองอยู่แล้ว %s เครื่อง', v_booked_qty, v_booked_qty)
    );
  end if;

  select coalesce(sum(spi.qty), 0) into v_allocated_elsewhere
  from public.session_phone_inventory spi
  join public.concert_sessions cs on cs.id = spi.session_id
  where spi.phone_id = p_phone_id
    and spi.session_id <> p_session_id
    and cs.start_at >= v_day_start
    and cs.start_at < v_day_end;

  v_available := v_phone_qty - v_allocated_elsewhere;
  if p_qty > v_available then
    return jsonb_build_object(
      'error',
      format(
        'ตั้งได้สูงสุด %s เพราะมีรอบอื่นในวันเดียวกันจัดสรรไปแล้ว %s จากทั้งหมด %s',
        v_available, v_allocated_elsewhere, v_phone_qty
      )
    );
  end if;

  insert into public.session_phone_inventory (session_id, phone_id, qty)
  values (p_session_id, p_phone_id, p_qty)
  on conflict (session_id, phone_id) do update set qty = excluded.qty;

  return jsonb_build_object('ok', true);
end;
$function$;

revoke execute on function public.set_session_phone_quota(uuid, uuid, integer) from PUBLIC, anon, authenticated;
