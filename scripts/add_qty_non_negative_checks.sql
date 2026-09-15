-- ให้ผู้ใช้รันเองใน Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════
-- เพิ่มด่าน CHECK (qty >= 0) ให้ 3 ตารางที่ยังไม่มี
--
-- ที่มา: ตรวจเมื่อ 12 ก.ย. 2569 พบว่าในบรรดาคอลัมน์ qty ทั้ง 4 ที่เป็นจำนวนของจริง
-- มีแค่ session_phone_inventory ที่มี CHECK กันค่าติดลบไว้ อีก 3 ตารางไม่มี
-- (ทดสอบด้วยการสั่ง UPDATE qty = -1 จริง → 3 ตารางนั้นฐานข้อมูลยอมรับ)
--
--   session_phone_inventory   🛡️ มีอยู่แล้ว
--   session_lens_inventory    ⚠️ ไม่มี
--   phones                    ⚠️ ไม่มี
--   lenses                    ⚠️ ไม่มี
--
-- ทำไมต้องมี: ฝั่งแอปตรวจไว้หมดแล้ว (API ปฏิเสธค่าติดลบตั้งแต่ชั้น validation)
-- ความเสี่ยงจริงคือการรัน SQL ด้วยมือใน SQL Editor เช่นลืมใส่ where:
--     update lenses set qty = qty - 3;      ← โดนทุกแถว
-- ตอนนี้ฐานข้อมูลยอมรับเงียบๆ แล้วสต็อกเพี้ยนโดยไม่มีใครรู้
-- ถ้ามี CHECK จะ error ทันทีตั้งแต่บรรทัดนั้น ไม่มีอะไรถูกเขียน
--
-- ผลถ้าติดลบจริง: set_session_quota_batch คิดเพดานจาก lenses.qty ตรงๆ
--     v_available := v_total_qty - v_allocated_elsewhere;
-- ค่าติดลบจะทำให้ตั้งโควต้าไม่ได้เลย พร้อม error ที่ไล่หาต้นตอยาก
--
-- ปลอดภัย: ตารางเล็กมาก ใช้เวลาเสี้ยววินาที · รันซ้ำได้ (ข้ามถ้ามีอยู่แล้ว)
-- ไม่แตะข้อมูลสักแถว แค่เพิ่มกฎ
-- ═══════════════════════════════════════════════════════════════

-- ═══ (1) ตรวจก่อน — ต้องได้ 0 ทุกแถว ถ้าไม่ใช่ ให้แก้ข้อมูลก่อนแล้วค่อยรันส่วนที่ 2 ═══
select 'session_lens_inventory' as ตาราง, count(*) as แถวที่ติดลบ from public.session_lens_inventory where qty < 0
union all
select 'phones', count(*) from public.phones where qty < 0
union all
select 'lenses', count(*) from public.lenses where qty < 0;

-- ═══ (2) เพิ่ม constraint ═══
-- Postgres ไม่มี ADD CONSTRAINT IF NOT EXISTS จึงต้องเช็ค pg_constraint เอง
-- ใช้ชื่อตามธรรมเนียมของ Postgres (<ตาราง>_<คอลัมน์>_check) ให้เหมือน
-- ที่ session_phone_inventory ใช้อยู่ จะได้อ่านแล้วรู้ทันทีว่าคืออะไร
do $$
declare
  r record;
  v_bad bigint;
begin
  for r in
    select unnest(array[
      'session_lens_inventory',
      'phones',
      'lenses'
    ]) as tbl
  loop
    -- กันพลาด: ถ้ามีแถวติดลบอยู่ ALTER จะ fail อยู่แล้ว แต่ error ของ Postgres
    -- อ่านยาก จึงเช็คเองก่อนแล้วบอกให้ชัดว่าตารางไหนและกี่แถว
    execute format('select count(*) from public.%I where qty < 0', r.tbl) into v_bad;
    if v_bad > 0 then
      raise exception 'ตาราง % มี % แถวที่ qty ติดลบอยู่ — แก้ข้อมูลให้เป็น 0 หรือมากกว่าก่อน แล้วรันใหม่', r.tbl, v_bad;
    end if;

    if exists (
      select 1
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public'
        and t.relname = r.tbl
        and c.contype = 'c'
        and c.conname = r.tbl || '_qty_check'
    ) then
      raise notice 'ข้าม %  — มี %_qty_check อยู่แล้ว', r.tbl, r.tbl;
    else
      execute format(
        'alter table public.%I add constraint %I check (qty >= 0)',
        r.tbl, r.tbl || '_qty_check'
      );
      raise notice 'เพิ่มแล้ว  %_qty_check', r.tbl;
    end if;
  end loop;
end;
$$;

-- ═══ (3) ตรวจผลหลังรัน — ต้องเห็นครบทั้ง 4 ตาราง ═══
select
  t.relname                                   as ตาราง,
  c.conname                                   as ชื่อกฎ,
  pg_get_constraintdef(c.oid)                 as เงื่อนไข
from pg_constraint c
join pg_class t      on t.oid = c.conrelid
join pg_namespace n  on n.oid = t.relnamespace
where n.nspname = 'public'
  and c.contype = 'c'
  and t.relname in ('session_phone_inventory', 'session_lens_inventory', 'phones', 'lenses')
  and pg_get_constraintdef(c.oid) ilike '%qty%'
order by t.relname;

-- ═══ (4) ทดสอบว่าด่านทำงานจริง (ไม่บังคับ) ═══
-- คำสั่งนี้ต้อง error ด้วย "violates check constraint" ถ้าผ่านแปลว่ายังไม่ติด
-- ห่อ rollback ไว้แล้ว ไม่มีอะไรถูกเขียนแม้ในกรณีที่ยังไม่มี constraint
--
--   begin;
--     update public.lenses set qty = -1 where id = (select id from public.lenses limit 1);
--   rollback;
