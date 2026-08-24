-- ให้ผู้ใช้รันเองใน Supabase SQL Editor
-- ลบข้อมูลที่ผูกอยู่กับ user ซ้ำ (บัญชี "aof" ตัวเก่า, สร้างเมื่อ 6 มี.ค. 2569, line_sub เก่า)
-- ก่อน ถึงจะกลับไปกดปุ่ม "Delete user" ในหน้า Authentication > Users ได้สำเร็จ
-- (ตอนนี้ลบไม่ได้เพราะมี foreign key จาก profiles/line_identities ชี้มาที่ user นี้ค้างอยู่)

-- แก้ user_id ตรงนี้ถ้าจะใช้ลบบัญชีอื่นในอนาคต
-- ค่านี้คือ user_id ของบัญชี aof ตัวเก่า (line_sub เก่า Uc47f66c89a2a2cc896887d6c80cbb2ea)
delete from public.bookings        where user_id = '3af276d4-5b7c-4f5c-bc4f-71ebb94cc2d7';
delete from public.reviews         where user_id = '3af276d4-5b7c-4f5c-bc4f-71ebb94cc2d7';
delete from public.line_identities where user_id = '3af276d4-5b7c-4f5c-bc4f-71ebb94cc2d7';
delete from public.profiles        where id      = '3af276d4-5b7c-4f5c-bc4f-71ebb94cc2d7';

-- รันเสร็จแล้วกลับไปที่ Authentication > Users แล้วกด Delete user ที่แถวนี้อีกครั้ง จะลบสำเร็จ
