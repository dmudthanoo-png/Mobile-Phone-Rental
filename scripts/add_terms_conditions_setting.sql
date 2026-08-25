-- ให้ผู้ใช้รันเองใน Supabase SQL Editor
-- เพิ่มช่องเก็บข้อความ "ข้อตกลงและเงื่อนไข" ที่แอดมินแก้ไขได้เอง (โชว์ใน modal ตอนลูกค้าจอง)
-- ค่าว่าง/NULL = ใช้ข้อความตัวอย่างเริ่มต้นที่ฝังไว้ในแอปเหมือนเดิม

alter table public.app_settings
  add column if not exists terms_conditions text;
