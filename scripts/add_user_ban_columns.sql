-- ให้ผู้ใช้รันเองใน Supabase SQL Editor
-- เพิ่มคอลัมน์สำหรับระบบแบนผู้ใช้

alter table public.profiles
  add column if not exists is_banned boolean not null default false,
  add column if not exists banned_at timestamptz,
  add column if not exists ban_reason text;

create index if not exists profiles_is_banned_idx on public.profiles (is_banned);

-- middleware เช็คแบนจาก line_sub ทุก request ที่ล็อกอินอยู่ ต้องมี index ให้เร็ว
create index if not exists profiles_line_sub_idx on public.profiles (line_sub);
