-- ให้ผู้ใช้รันเองใน Supabase SQL Editor
-- เพิ่ม 2FA (Google Authenticator / TOTP) ให้บัญชีแอดมิน — เปิด/ปิดได้ต่อบัญชี ไม่บังคับทันที

alter table public.admin_users
  add column if not exists totp_secret text,
  add column if not exists totp_enabled boolean not null default false;
