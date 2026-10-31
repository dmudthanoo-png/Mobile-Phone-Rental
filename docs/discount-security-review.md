# ตรวจเงื่อนไขและความปลอดภัยโค้ดส่วนลด — 31 ตุลาคม 2026

ตรวจ source code, SQL/RPC/trigger, HTTP handlers, UI state, dependency lockfile และอ่านสิทธิ์จริงจาก Supabase project ที่ตรงกับ NEXT_PUBLIC_SUPABASE_URL โดยไม่อ่านข้อมูลลูกค้า ไม่สร้างรายการทดสอบใน production ไม่รัน migration จริง และไม่ deploy

## สิ่งที่พบและแก้ใน workspace

| ระดับ | ปัญหาและหลักฐาน | สิ่งที่แก้ | สถานะ |
| --- | --- | --- | --- |
| สูง | Production ยัง grant INSERT/UPDATE บน bookings แก่ authenticated; policy INSERT ตรวจเพียงเจ้าของ และ UPDATE ตรวจเจ้าของกับ pending ไม่ได้จำกัดคอลัมน์ให้อัปได้เฉพาะ slip_url ผู้มี Supabase authenticated token จึงข้ามการตรวจราคา/สต็อก/ผลตรวจสลิปใน Next API ได้ | เพิกถอนสิทธิ์เขียนตรง เพิ่ม restrictive policies กันสิทธิ์ระดับคอลัมน์ที่อาจหลงเหลือ คง service_role สำหรับ API | เตรียม SQL แล้ว **ยังไม่แก้ฐานข้อมูลจริง** |
| สูง | finalize hold เดิมและ finalize ส่วนลดไม่ได้ล็อก inventory ขณะเปลี่ยน hold เป็นรายการแนบสลิป หาก transaction ค้างข้ามเวลา expiry คำขอจองอีกอันอาจนับว่า hold เดิมหมดอายุ ทั้งที่อันแรกกำลัง commit | เพิ่ม trigger ล็อก phone แล้ว lens ตรวจเวลาจริงและความจุหลังได้ lock ทำงานทั้ง RPC ใหม่และเก่า | เตรียม SQL แล้ว **ยังไม่แก้ฐานข้อมูลจริง** |
| กลาง | storage.objects มี policy authenticated INSERT เข้า slips ที่ตรวจแค่ bucket ทำให้ข้ามการตรวจ magic bytes/เส้นทาง/อัตราการส่งใน API ได้ แม้ bucket มีเพดาน 8 MB และ MIME allowlist แล้ว | restrictive policy เฉพาะ slips ให้ server API เป็นผู้เขียน/อ่าน ยังคง bucket อื่นและ signed URL ที่ server ออกให้ | เตรียม SQL แล้ว **ยังไม่แก้ฐานข้อมูลจริง** |
| กลาง | timer และปุ่มย้อนกลับ/หน้าแรกรีเซ็ตข้อมูลได้ระหว่างรอ reserve/upload จึงอาจปล่อย hold ระหว่างอัปโหลด หรือแสดงหน้าสำเร็จด้วยข้อมูลที่ถูกล้าง และ timer ของขั้นก่อนหน้าที่หมดแล้วอาจรีเซ็ตขั้นชำระเงินที่เพิ่งเปิด | ล็อกคำขอระหว่างส่ง ปิดการแก้ฟอร์ม/ย้อนกลับ รอผลก่อนหมดเวลา ตรวจว่า timer เป็นของขั้นปัจจุบัน | แก้โค้ดแล้ว รอ deploy |
| ต่ำ | เปลี่ยนหน้าในรายการโค้ดขณะกำลังบันทึก ทำให้ reload ของคำขอเดิมดึงรายการหน้าก่อนมาแสดงใต้เลขหน้าใหม่ | ปิด pagination ระหว่างบันทึก | แก้โค้ดแล้ว รอ deploy |

SQL เพิ่มเติม: `supabase/migrations/20261031124225_harden_discount_checkout.sql` รันหลัง migration โค้ดส่วนลดเดิม ไม่แก้ราคาหรือประวัติการจอง ไม่ยกเลิกหรือคืนเงินรายการใด

การป้องกัน race ใช้ lock เดียวกับการกัน stock จน transaction จบ ตาม [PostgreSQL locking](https://www.postgresql.org/docs/current/explicit-locking.html) และพิจารณาการเห็นข้อมูลที่ยังไม่ commit ตาม [Read Committed](https://www.postgresql.org/docs/current/transaction-iso.html#XACT-READ-COMMITTED)

## ประเด็นที่ยังค้าง — dependency

ผล `npm audit --omit=dev` วันที่ตรวจ: **9 แพ็กเกจ** แบ่งเป็น critical 1, high 7, moderate 1 จำนวนนี้เป็นกลุ่มแพ็กเกจที่ audit แจ้ง ไม่ใช่จำนวนเส้นทางโจมตีที่ยืนยันว่าเข้าถึงได้บน deployment นี้

| แพ็กเกจ | เวอร์ชันใน lockfile | ระดับจาก audit |
| --- | --- | --- |
| next | 16.1.7 | critical |
| axios | 1.19.0 | high |
| follow-redirects | 1.16.0 | high |
| nanoid | 3.3.11 | high |
| postcss | 8.4.31 ภายใน Next, 8.5.6 ที่ root | high |
| sharp | 0.34.5 | high |
| source-map-js | 1.2.1 | high |
| ws | 8.19.0 | high |
| baseline-browser-mapping | 2.10.0 | moderate |

ต้องอัปเดต dependency ที่ได้รับผลกระทบและตรวจ login/LINE/ภาพ/การจองร่วมด้วย รอบนี้ไม่ได้เปลี่ยน package.json หรือ lockfile จึง **ยังถือว่าประเด็นนี้ไม่ถูกแก้** และไม่ได้ใช้ `npm audit fix --force`

ตัวอย่างประกาศที่ตรวจจากผู้ดูแลโดยตรง:

- [Next.js RCE บน Windows](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36) กระทบ Next 16 ก่อน 16.3.3 **เมื่อ host บน Windows** ไม่สรุปว่าเงื่อนไขนี้เกิดกับ Vercel Linux ด้วย
- [Next.js / sharp AVIF optimization RCE](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4) มีเงื่อนไขเกี่ยวกับการ optimize รูป AVIF จึงต้องตรวจเส้นทางรูปและแพ็กเกจร่วมกัน เว็บนี้มี next/image แต่รอบนี้ไม่ได้ทดสอบ exploit กับระบบจริง
- Audit ยังแจ้งประกาศใหม่กว่าสองรายการนี้ด้วย จึงไม่ควรเลือก 16.3.3 เพียงเพราะแก้สองประกาศข้างต้น ต้องตรวจเวอร์ชันที่จะอัปเดตกับ audit ล่าสุดอีกครั้ง

## ข้อสังเกตจาก Supabase Advisors

- ตาราง discount_codes / discount_uses เปิด RLS, ไม่มี policy สำหรับ browser และ revoke public/anon/authenticated แล้ว; RPC ส่วนลดทั้งหมดไม่ให้ anon/authenticated execute ตามที่ออกแบบ
- ข้อความ “RLS enabled, no policy” ของตารางที่เข้าผ่าน service_role ไม่ใช่หลักฐานว่าข้อมูลเปิดสาธารณะ ไม่เพิ่ม allow-all policy เพื่อทำให้คำเตือนหาย
- ตาราง bookings มี SELECT แบบเจ้าของ ไม่พบ policy anon SELECT ที่เปิดอ่านข้อมูลลูกค้าทั้งหมด; warning GraphQL schema visibility หมายถึงเห็นโครงสร้าง ไม่ใช่ยืนยันว่าอ่านทุกแถวได้ ดู [Supabase schema visibility](https://supabase.com/docs/guides/database/database-linter?lint=0026_pg_graphql_anon_table_exposed)
- ยังมี 20 ฟังก์ชันเดิมที่ไม่ได้กำหนด search_path ดู [แนวทางแก้](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable) RPC จองที่ตรวจยังเป็น SECURITY INVOKER และปิด execute ให้ browser แล้ว จึงไม่สรุปว่าเท่ากับ privilege escalation อัตโนมัติ
- handle_new_user เป็น SECURITY DEFINER ที่ยังมี browser EXECUTE grant แต่ return type เป็น trigger จึงไม่ใช่ RPC ที่เรียกตรงแล้วทำงานได้ตามปกติ ควรลด grant และกำหนด search_path แยก โดยคงการสร้าง profile จาก Auth trigger
- [Leaked password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) ยังปิดอยู่ แต่ระบบลูกค้าใช้ LINE และแอดมินใช้ auth ของแอปเอง การเปิด Supabase option นี้อย่างเดียวไม่ได้ป้องกันรหัสผ่านแอดมินของแอป
- Rate limit ปัจจุบันเก็บใน memory ต่อ instance จึงไม่รวมยอดข้าม instance; การจำกัดส่วนลดบัญชีละครั้งยังบังคับในฐานข้อมูลแยกจาก limiter นี้

## กติกาที่ตรวจแล้ว

- ลดเป็นบาทครั้งเดียวจากยอดรวมมือถือและเลนส์ ทุกคอนเสิร์ต ไม่จำกัดจำนวนสิทธิ์รวม
- หนึ่งโค้ดต่อการจอง หนึ่งการใช้ต่อบัญชีที่ล็อกอิน ไม่เชื่อ user_id/ยอดส่วนลดที่ส่งจาก client
- มัดจำไม่ลด ยอดสุทธิต่ำกว่ามัดจำไม่ได้ รวมถึงการลบ/แก้เลนส์ภายหลัง
- Hold หมดอายุ/ปล่อย hold ก่อนแนบสลิปไม่กินสิทธิ์ถาวร แต่เริ่มใหม่ต้องตรวจว่าโค้ดยังเปิดและไม่หมดอายุ
- ส่งสลิปสำเร็จแล้วถือว่าใช้สิทธิ์ การปฏิเสธยังแก้สลิปที่รายการเดิมได้ การยกเลิกหรือการลบ booking ไม่คืนสิทธิ์
- พัก/ลบ/หมดอายุโค้ดไม่แก้ยอดของ hold ที่ยอมรับไปแล้ว แต่ไม่ได้ต่ออายุ hold
- แอดมินแก้ชื่อโปรโมชัน/จำนวนเงิน/เวลาได้ เปลี่ยนรหัสโค้ดเดิมหรือลบแล้วสร้างรหัสซ้ำไม่ได้
- โค้ดไม่ได้ผูกกับรายชื่อผู้รับใน LINE OA: หากลูกค้าส่งโค้ดต่อ บัญชีอื่นที่รู้โค้ดยังใช้ได้ตามกติกาบัญชีละครั้ง เป็นข้อจำกัดทางธุรกิจที่ยังคงตามแผน ไม่ได้เพิ่ม whitelist เอง

## การยืนยันและข้อจำกัด

เพิ่ม regression tests ที่ล้มเหลวก่อนแก้เรื่อง inventory locks/over-capacity และสิทธิ์เขียนตรง แล้วผ่านหลัง migration ใหม่ ใช้ PostgreSQL ใน PGlite แยกจาก production ตรวจ lock ที่ยังอยู่ใน transaction, rollback เมื่อสต็อกไม่พอ, browser-role denial, service-role operation, restrictive Storage policy และกติกา timer

ผลตรวจในเครื่อง: `npm test` ผ่าน 123 รายการ, TypeScript ผ่าน และ production build ผ่าน; lint ไฟล์ที่แก้ไม่มี error มี warning เดิมเรื่อง dependency ของ loadConcerts ในหน้าแรก 2 จุด

แก้ migration หลังพบ `42501: must be owner of table objects`: ตัด `ALTER TABLE storage.objects` ที่ไม่รองรับบน hosted Supabase ออก เปลี่ยนเป็นตรวจ RLS ที่มีอยู่ก่อนสร้าง restrictive policy ตรวจ metadata แบบอ่านอย่างเดียวแล้วพบว่า RLS เปิดอยู่ และ `supautils.policy_grants` อนุญาตให้ `postgres` จัดการ policy บนตารางนี้ได้ ไม่เปลี่ยนเจ้าของตารางหรือสิทธิ์ของ role ระบบ ตาม [คำอธิบายของ Supabase](https://github.com/orgs/supabase/discussions/36611) ชุดทดสอบฐานข้อมูลหลังแก้ผ่าน 30 รายการ รวมกรณี RLS ปิดต้องหยุดและ rollback ส่วน fixture เปิด Storage RLS ล่วงหน้าให้ตรงกับบริการจริง PGlite ไม่จำลอง extension `supautils` จึงไม่ได้แทนการยืนยันสิทธิ์ DDL บน hosted Supabase และยังไม่ได้รัน migration ฉบับแก้บนฐานข้อมูลจริง

ไม่ทำ stress test หลาย connection บนฐานข้อมูลจริง ไม่ลองโจมตี production ไม่ใช้บัญชีลูกค้าจริงกด UI และไม่ได้อัปเดต dependency จึงไม่ควรตีความผลนี้ว่าเป็นการรับรองว่าไม่มีช่องโหว่อื่น
