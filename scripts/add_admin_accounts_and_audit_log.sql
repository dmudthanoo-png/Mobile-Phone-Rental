-- ให้ผู้ใช้รันเองใน Supabase SQL Editor
-- เปลี่ยนจากรหัสผ่านเดียวใช้ร่วมกัน (ADMIN_PASSWORD) เป็นหลายบัญชีแอดมิน
-- แยก username/password จริง + เก็บประวัติการดำเนินการของแอดมินแต่ละคน

-- บัญชีแอดมิน (password_hash = "salt:hash" จาก scrypt ไม่ใช่รหัสผ่านตรงๆ)
create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

-- ตาราง admin_login_attempts มีอยู่แล้วในระบบ (เก็บ ip + success สำหรับ cooldown)
-- เพิ่มคอลัมน์ username เพื่อรู้ว่าพยายามล็อกอินเป็นใคร (เผื่อไว้ตรวจสอบ/รายงานย้อนหลัง)
alter table public.admin_login_attempts
  add column if not exists username text;

-- ประวัติการดำเนินการของแอดมิน
create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_username text not null,
  action text not null,
  detail text,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_username_idx on public.admin_audit_log (admin_username);
create index if not exists admin_audit_log_created_at_idx on public.admin_audit_log (created_at desc);

-- หมายเหตุ: ไม่ต้อง insert บัญชีแอดมินคนแรกด้วยตัวเองที่นี่
-- หลังรัน SQL นี้แล้ว ให้เปิดหน้า /admin แล้วจะเจอฟอร์ม "ตั้งค่าบัญชีแอดมินคนแรก"
-- ระบบจะให้สร้างบัญชีได้เลยตอนที่ตาราง admin_users ยังว่างอยู่ (ครั้งเดียวเท่านั้น)
-- รหัสผ่านจะถูก hash ฝั่งเซิร์ฟเวอร์ก่อนบันทึก ไม่มีใครเห็นรหัสผ่านจริงเก็บอยู่ในฐานข้อมูล
