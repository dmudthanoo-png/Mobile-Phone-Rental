-- ให้ผู้ใช้รันเองใน Supabase SQL Editor "ทันที" — แก้ช่องโหว่ที่ตาราง admin_users /
-- admin_login_attempts / admin_audit_log ถูกสร้างไว้โดยไม่ได้เปิด row level security
-- (RLS ปิด = role anon/authenticated ที่ยิงผ่าน PostgREST ตรงๆ อาจอ่าน/เขียนได้ ซึ่งรวมถึง
-- password_hash ในตาราง admin_users ด้วย) โค้ดของแอปเองใช้ service role key เสมอ (ข้าม RLS
-- อยู่แล้ว) จึงปิดสิทธิ์ anon/authenticated ทั้งหมดได้โดยไม่กระทบการทำงานของแอป

alter table public.admin_users enable row level security;
alter table public.admin_login_attempts enable row level security;
alter table public.admin_audit_log enable row level security;

revoke all on public.admin_users from anon, authenticated;
revoke all on public.admin_login_attempts from anon, authenticated;
revoke all on public.admin_audit_log from anon, authenticated;

-- ── เช็คเผื่อไว้: ตารางอื่นในโปรเจกต์ที่ RLS ยังปิดอยู่ (rowsecurity = false) ──
-- รันคำสั่งนี้แยกต่างหากเพื่อดูว่ามีตารางไหนใน public schema ที่ยังไม่เปิด RLS อีกบ้าง
-- ถ้าเจอตารางที่มีข้อมูลลูกค้า/ธุรกรรม (เช่น bookings, phones, profiles) แล้ว rowsecurity = false
-- ต้องตรวจสอบสิทธิ์ anon/authenticated ของตารางนั้นด้วยว่าอ่าน/เขียนตรงๆ ได้หรือไม่
--
-- select schemaname, tablename, rowsecurity
-- from pg_tables
-- where schemaname = 'public'
-- order by rowsecurity asc, tablename;
