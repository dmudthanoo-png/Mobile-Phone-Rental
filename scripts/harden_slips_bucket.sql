-- ให้ผู้ใช้รันเองใน Supabase SQL Editor
-- ตอนนี้ bucket "slips" เป็น private แล้ว (ยืนยันจาก production) แต่ file_size_limit และ
-- allowed_mime_types ยังเป็น NULL — แปลว่า Storage เองไม่ได้บังคับขนาด/ชนิดไฟล์เลย
-- (พึ่งแค่โค้ดฝั่ง Next.js เช็คเท่านั้น) เพิ่มการบังคับที่ระดับ bucket ไว้เป็นชั้นป้องกันซ้อน

update storage.buckets
set
  file_size_limit = 8388608, -- 8MB ตรงกับที่ route เช็คไว้
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'slips';

-- เช็คผลลัพธ์
select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'slips';
