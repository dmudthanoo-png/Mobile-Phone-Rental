-- ให้ผู้ใช้รันเองใน Supabase SQL Editor
-- ตาราง privacy_notice_acknowledgements ถูกสร้างไปแล้วในระบบจริงด้วยสคริปต์ชุดแรก
-- (ตอนนั้นตั้ง on delete cascade ไว้) — แก้ไขในไฟล์ scripts/add_privacy_notice_acknowledgements.sql
-- เป็น on delete set null แล้ว แต่ "create table if not exists" จะไม่ไปแก้ตารางที่มีอยู่แล้ว
-- สคริปต์นี้แก้ constraint ของตารางที่มีอยู่แล้วให้ตรงกับที่ตั้งใจไว้จริง (ปลอดภัย รันซ้ำได้)
--
-- เหตุผล: ถ้ายังเป็น cascade อยู่ พอลบบัญชีผู้ใช้ทีหลัง หลักฐานว่าเคยรับทราบนโยบายจะหายไปด้วย

do $$
declare
  fk_name text;
begin
  select tc.constraint_name into fk_name
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
  where tc.table_schema = 'public'
    and tc.table_name = 'privacy_notice_acknowledgements'
    and tc.constraint_type = 'FOREIGN KEY'
    and kcu.column_name = 'user_id'
  limit 1;

  if fk_name is not null then
    execute format('alter table public.privacy_notice_acknowledgements drop constraint %I', fk_name);
  end if;
end $$;

alter table public.privacy_notice_acknowledgements
  alter column user_id drop not null;

alter table public.privacy_notice_acknowledgements
  add constraint privacy_notice_acknowledgements_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;

-- เช็คผลลัพธ์
select conname, confdeltype
from pg_constraint
where conrelid = 'public.privacy_notice_acknowledgements'::regclass
  and contype = 'f';
-- confdeltype ควรเป็น 'n' (SET NULL) ไม่ใช่ 'c' (CASCADE) แล้ว
