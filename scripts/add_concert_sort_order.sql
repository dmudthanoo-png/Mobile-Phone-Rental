-- ให้ผู้ใช้รันเองใน Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════
-- ให้แอดมินจัดลำดับคอนเสิร์ตเองได้ว่าอันไหนขึ้นก่อน
--
-- เดิมหน้าลูกค้าเรียงตาม created_at desc อย่างเดียว (คอนเสิร์ตที่สร้างล่าสุดขึ้นก่อน)
-- แอดมินควบคุมอะไรไม่ได้เลย ถ้าอยากดันคอนเสิร์ตที่กำลังจะถึงขึ้นบนต้องลบแล้วสร้างใหม่
--
-- วิธีเรียงหลังรันสคริปต์นี้:  order by sort_order asc, created_at desc
--   • sort_order น้อย = อยู่บน
--   • ค่า default 0 = คอนเสิร์ตที่สร้างใหม่จะขึ้นบนสุดเสมอ (พฤติกรรมเดิมก่อนมีฟีเจอร์นี้)
--     และถ้าเสมอกันหลายอัน ตัวที่สร้างล่าสุดขึ้นก่อน — เหมือนเดิมเป๊ะ
-- ═══════════════════════════════════════════════════════════════

-- ═══ (1) คอลัมน์ใหม่ ═══
alter table public.concerts
  add column if not exists sort_order integer not null default 0;

comment on column public.concerts.sort_order is
  'ลำดับการแสดงผลที่แอดมินจัดเอง — น้อย = อยู่บน, 0 = ยังไม่จัด (ใช้ created_at desc แทน)';

create index if not exists concerts_sort_order_idx
  on public.concerts (sort_order, created_at desc);

-- ═══ (2) backfill — ตรึงลำดับที่เห็นอยู่ตอนนี้ไว้ ═══
-- ถ้าไม่ทำ ทุกแถวจะเป็น 0 เท่ากันหมด ซึ่งก็ยังเรียงเหมือนเดิมได้ (ตกไปใช้ created_at)
-- แต่พอแอดมินกดเลื่อนครั้งแรก อันที่ไม่ได้ขยับจะยังเป็น 0 แล้วกระโดดขึ้นบนสุดทันที
-- จึงต้องให้เลขจริงกับทุกแถวก่อน เพื่อให้การเลื่อนครั้งแรกไม่ทำลำดับพัง
with ordered as (
  select id, row_number() over (order by created_at desc, id) as rn
  from public.concerts
)
update public.concerts c
set sort_order = o.rn
from ordered o
where o.id = c.id
  and c.sort_order = 0;   -- แตะเฉพาะที่ยังไม่เคยจัด รันซ้ำแล้วลำดับที่จัดไว้ไม่หาย

-- ═══ (3) RPC บันทึกลำดับใหม่ทั้งชุดในทรานแซกชันเดียว ═══
-- รับ array ของ id ตามลำดับที่ต้องการ (ตัวแรก = บนสุด) แล้วเขียน sort_order = 1..N
-- ทำทีเดียวทั้งชุด ไม่ใช่ยิง update ทีละแถว เพราะถ้าพลาดกลางทางลำดับจะเพี้ยนครึ่งๆ กลางๆ
create or replace function public.set_concert_order(p_ids uuid[])
returns jsonb
language plpgsql
as $function$
declare
  v_given    integer;
  v_distinct integer;
  v_exists   integer;
  v_updated  integer;
begin
  if p_ids is null or array_length(p_ids, 1) is null then
    return jsonb_build_object('error', 'EMPTY');
  end if;

  select count(*), count(distinct x) into v_given, v_distinct
  from unnest(p_ids) as x;

  -- id ซ้ำ = ลำดับกำกวม ไม่รู้จะเอาตำแหน่งไหน
  if v_given <> v_distinct then
    return jsonb_build_object('error', 'DUPLICATE_ID');
  end if;

  select count(*) into v_exists
  from public.concerts where id = any(p_ids);

  -- มี id ที่ไม่มีอยู่จริง (เช่น คอนเสิร์ตถูกลบไประหว่างที่แอดมินเปิดหน้าค้างไว้)
  if v_exists <> v_given then
    return jsonb_build_object('error', 'UNKNOWN_ID', 'given', v_given, 'found', v_exists);
  end if;

  update public.concerts c
  set sort_order = t.ord
  from (
    select u.id, u.ord::integer as ord
    from unnest(p_ids) with ordinality as u(id, ord)
  ) t
  where c.id = t.id
    and c.sort_order is distinct from t.ord;

  get diagnostics v_updated = row_count;

  return jsonb_build_object('ok', true, 'given', v_given, 'updated', v_updated);
end;
$function$;

-- เรียกได้จาก service_role (ฝั่ง API แอดมิน) เท่านั้น
revoke execute on function public.set_concert_order(uuid[]) from PUBLIC, anon, authenticated;

-- ═══ (4) ตรวจผล — ลำดับที่ลูกค้าจะเห็น ═══
select
  sort_order  as ลำดับ,
  title       as คอนเสิร์ต,
  case when archived then 'archive' when is_visible = false then 'ซ่อน' else 'แสดง' end as สถานะ,
  created_at
from public.concerts
order by sort_order asc, created_at desc;
