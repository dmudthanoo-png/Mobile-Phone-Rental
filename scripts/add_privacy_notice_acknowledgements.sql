-- ให้ผู้ใช้รันเองใน Supabase SQL Editor ก่อน deploy โค้ด privacy-notice
-- ตารางนี้บันทึกว่าผู้ใช้รับทราบนโยบายความเป็นส่วนตัวเวอร์ชันไหน เมื่อไหร่ (ไม่ใช่ตารางยินยอมการตลาด)

create table if not exists public.privacy_notice_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  -- ตั้งใจไม่ใช้ on delete cascade — ถ้าลบบัญชีผู้ใช้ทีหลัง ยังต้องเหลือหลักฐานไว้ว่า
  -- เคยรับทราบนโยบายฉบับไหนไปแล้ว (user_id จะกลายเป็น null แทนที่จะลบแถวทิ้งไปด้วย)
  user_id uuid references auth.users(id) on delete set null,
  policy_version text not null,
  acknowledged_at timestamptz not null default now(),
  source text not null default 'website',
  created_at timestamptz not null default now(),
  unique (user_id, policy_version)
);

create index if not exists privacy_notice_acknowledgements_user_id_idx
  on public.privacy_notice_acknowledgements (user_id, acknowledged_at desc);

alter table public.privacy_notice_acknowledgements enable row level security;

revoke all on table public.privacy_notice_acknowledgements from public, anon, authenticated;
grant select, insert, update on table public.privacy_notice_acknowledgements to service_role;
