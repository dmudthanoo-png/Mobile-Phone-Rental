-- ให้ผู้ใช้รันเองใน Supabase SQL Editor
-- ⚠️ ต้องรัน "หลัง" scripts/fix_quota_lock_ordering.sql
--
-- ═══ ย้ายวัน/เวลารอบแบบ atomic ═══
--
-- ปัญหา: ฝั่ง API ตรวจโควต้าเสร็จแล้วค่อยสั่ง update วันใหม่ เป็นคนละคำสั่งกัน
-- แอดมิน (หรือแท็บ) สองอันย้ายรอบคนละรอบเข้า "วันเดียวกัน" พร้อมกัน จะผ่านการตรวจทั้งคู่
-- เพราะต่างฝ่ายต่างยังไม่เห็นการย้ายของอีกฝ่าย → วันนั้นจัดสรรรวมเกินสต็อกจริง
--
-- แก้โดยย้ายทั้ง "ตรวจ + เขียน" มาไว้ในฟังก์ชันเดียว และล็อกแถวสต็อกของทุกรุ่น/เลนส์ที่เกี่ยวข้อง
-- ก่อนนับ ทำให้การย้ายสองรอบเข้าวันเดียวกันต้องเข้าคิวกันจริงๆ

create or replace function public.move_concert_session(
  p_concert_id uuid,
  p_session_id uuid,
  p_start_at timestamptz,
  p_note text default null
)
returns jsonb
language plpgsql
as $function$
declare
  v_day_start   timestamptz;
  v_day_end     timestamptz;
  v_exists      boolean;
  r             record;
  v_total       integer;
  v_elsewhere   integer;
begin
  select true into v_exists
  from public.concert_sessions
  where id = p_session_id and concert_id = p_concert_id;

  if v_exists is null then
    return jsonb_build_object('error', 'SESSION_NOT_FOUND');
  end if;

  v_day_start := date_trunc('day', p_start_at at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok';
  v_day_end := v_day_start + interval '1 day';

  -- ── มือถือ: ล็อกแถวสต็อกรวมของทุกรุ่นที่รอบนี้ถือโควต้าอยู่ (เรียง id กัน deadlock) ──
  for r in
    select spi.phone_id, spi.qty
    from public.session_phone_inventory spi
    where spi.session_id = p_session_id and spi.qty > 0
    order by spi.phone_id
  loop
    select qty into v_total from public.phones where id = r.phone_id for update;

    select coalesce(sum(x.qty), 0) into v_elsewhere
    from public.session_phone_inventory x
    join public.concert_sessions cs on cs.id = x.session_id
    where x.phone_id = r.phone_id
      and x.session_id <> p_session_id
      and cs.start_at >= v_day_start
      and cs.start_at < v_day_end;

    if v_elsewhere + r.qty > coalesce(v_total, 0) then
      return jsonb_build_object(
        'error', 'PHONE_OVER_ALLOCATED',
        'phone_id', r.phone_id,
        'moving_qty', r.qty,
        'already_allocated', v_elsewhere,
        'total_qty', coalesce(v_total, 0)
      );
    end if;
  end loop;

  -- ── เลนส์: เงื่อนไขเดียวกัน ──
  for r in
    select sli.lens_id, sli.qty
    from public.session_lens_inventory sli
    where sli.session_id = p_session_id and sli.qty > 0
    order by sli.lens_id
  loop
    select qty into v_total from public.lenses where id = r.lens_id for update;

    select coalesce(sum(x.qty), 0) into v_elsewhere
    from public.session_lens_inventory x
    join public.concert_sessions cs on cs.id = x.session_id
    where x.lens_id = r.lens_id
      and x.session_id <> p_session_id
      and cs.start_at >= v_day_start
      and cs.start_at < v_day_end;

    if v_elsewhere + r.qty > coalesce(v_total, 0) then
      return jsonb_build_object(
        'error', 'LENS_OVER_ALLOCATED',
        'lens_id', r.lens_id,
        'moving_qty', r.qty,
        'already_allocated', v_elsewhere,
        'total_qty', coalesce(v_total, 0)
      );
    end if;
  end loop;

  -- ผ่านครบแล้วค่อยย้ายจริง อยู่ในทรานแซกชันเดียวกับการตรวจข้างบน
  update public.concert_sessions
  set start_at = p_start_at, note = p_note
  where id = p_session_id and concert_id = p_concert_id;

  return jsonb_build_object('ok', true);
end;
$function$;

revoke execute on function public.move_concert_session(uuid, uuid, timestamptz, text) from PUBLIC, anon, authenticated;
