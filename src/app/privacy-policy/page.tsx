import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import Footer from "../Footer";
import {
  PRIVACY_NOTICE_LAST_UPDATED,
  PRIVACY_NOTICE_VERSION,
} from "@/lib/privacyNotice";

export const metadata: Metadata = {
  title: "นโยบายความเป็นส่วนตัว | Crabby เช่ามือถือ",
  description: "นโยบายความเป็นส่วนตัวของ Crabby เช่ามือถือ",
};

const ink = "#241F1C";
const sub = "#6E625A";
const accent = "#D81F5E";
const accentSoft = "#FFE3EE";
const line = "#F2E4D6";
const paper = "rgba(255,255,255,0.86)";
const pageFont = "var(--font-noto-thai), 'Segoe UI', 'Leelawadee UI', -apple-system, system-ui, sans-serif";

function Section({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section style={{ borderTop: "1px solid " + line, paddingTop: 24, marginTop: 24 }}>
      <h2 style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 12px", color: ink, fontSize: 18 }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: 28,
            height: 28,
            borderRadius: 999,
            background: accentSoft,
            color: accent,
            fontSize: 13,
            fontWeight: 800,
          }}
        >
          {number}
        </span>
        {title}
      </h2>
      <div style={{ color: ink, fontSize: 14, lineHeight: 1.82 }}>{children}</div>
    </section>
  );
}

const listStyle = { margin: "8px 0 0", paddingLeft: 22 };
const codeStyle = {
  display: "inline-block",
  padding: "1px 6px",
  borderRadius: 5,
  background: "#F8F2ED",
  color: ink,
  fontFamily: "var(--font-plex-mono), monospace",
  fontSize: 12,
};

export default function PrivacyPolicyPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(60vw 60vw circle at 10% 0%, rgba(242,70,126,0.20), rgba(242,70,126,0) 70%), radial-gradient(55vw 55vw circle at 100% 20%, rgba(131,84,232,0.16), rgba(131,84,232,0) 70%), #FFFBF7",
        fontFamily: pageFont,
      }}
    >
      <div style={{ width: "100%", maxWidth: 820, margin: "0 auto", padding: "28px 20px 44px", boxSizing: "border-box" }}>
        <Link
          href="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            minHeight: 44,
            color: accent,
            fontSize: 14,
            fontWeight: 700,
            textDecoration: "none",
          }}
        >
          ← กลับหน้าแรก
        </Link>

        <article
          style={{
            marginTop: 8,
            padding: "28px 24px 32px",
            borderRadius: 24,
            background: paper,
            border: "1px solid rgba(255,255,255,0.78)",
            boxShadow: "0 18px 46px -28px rgba(36,31,28,0.30)",
          }}
        >
          <div style={{ display: "inline-flex", padding: "5px 10px", borderRadius: 999, background: accentSoft, color: accent, fontSize: 12, fontWeight: 800 }}>
            PDPA · Privacy Notice
          </div>
          <h1 style={{ margin: "14px 0 8px", color: ink, fontSize: 28, lineHeight: 1.25 }}>
            นโยบายความเป็นส่วนตัว
          </h1>
          <p style={{ margin: 0, color: sub, fontSize: 13, lineHeight: 1.7 }}>
            ปรับปรุงล่าสุด {PRIVACY_NOTICE_LAST_UPDATED} · เวอร์ชัน {PRIVACY_NOTICE_VERSION}
          </p>

          <p style={{ margin: "24px 0 0", color: ink, fontSize: 14, lineHeight: 1.82 }}>
            Crabby เช่ามือถือ (“เรา”) เคารพความเป็นส่วนตัวของท่าน และมุ่งคุ้มครองข้อมูลส่วนบุคคลตามพระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 (“PDPA”) นโยบายนี้อธิบายข้อมูลที่เว็บไซต์เก็บ ใช้ เปิดเผย และคุ้มครองเมื่อท่านเข้าสู่ระบบหรือใช้บริการจองเช่ามือถือและอุปกรณ์เสริมสำหรับการถ่ายคอนเสิร์ต
          </p>

          <Section number="1" title="ผู้ควบคุมข้อมูลส่วนบุคคล">
            <p style={{ margin: 0 }}>
              ผู้ควบคุมข้อมูลส่วนบุคคลคือ <strong>Crabby เช่ามือถือ</strong> ท่านสามารถติดต่อเรื่องข้อมูลส่วนบุคคลหรือใช้สิทธิของท่านได้ทาง{" "}
              <a href="https://line.me/R/ti/p/@CRABBY4RENT" target="_blank" rel="noopener noreferrer" style={{ color: accent, fontWeight: 700 }}>
                LINE @CRABBY4RENT
              </a>
            </p>
          </Section>

          <Section number="2" title="ข้อมูลส่วนบุคคลที่เราเก็บ">
            <ul style={listStyle}>
              <li><strong>ข้อมูลจาก LINE:</strong> LINE User ID ชื่อที่แสดง และรูปโปรไฟล์ เพื่อยืนยันตัวตนและผูกบัญชีผู้ใช้กับการจอง</li>
              <li><strong>ข้อมูลการจอง/เช่า:</strong> ชื่อผู้เช่า เบอร์โทรศัพท์ รายการเช่า คอนเสิร์ต รอบ วันเวลา จำนวน ราคา สถานะ และหมายเลขอ้างอิงการจอง</li>
              <li><strong>ข้อมูลการชำระเงิน:</strong> รูปสลิป ยอดเงิน ข้อมูลผลการตรวจสลิป และเลขอ้างอิงธุรกรรมเท่าที่จำเป็นต่อการยืนยันมัดจำและป้องกันการใช้สลิปซ้ำ</li>
              <li><strong>ข้อมูลความปลอดภัย:</strong> ข้อมูล session และบันทึกการดำเนินการเท่าที่จำเป็นต่อการรักษาความปลอดภัย ป้องกันการใช้งานโดยมิชอบ และตรวจสอบเหตุขัดข้อง</li>
              <li><strong>บันทึกการรับทราบ:</strong> เวอร์ชัน วันที่ เวลา และช่องทางที่ท่านรับทราบนโยบายฉบับนี้</li>
            </ul>
            <p style={{ margin: "12px 0 0" }}>
              เว็บไซต์ปัจจุบันไม่เก็บอีเมล วันเกิด หรือเลขบัตรประชาชนผ่านแบบฟอร์มออนไลน์ หากจำเป็นต้องตรวจบัตรประชาชนตัวจริงในวันรับเครื่อง จะดำเนินการเท่าที่จำเป็นต่อการยืนยันตัวตน และจะแจ้งรายละเอียดเพิ่มเติมก่อนเก็บสำเนาหรือข้อมูลใด ๆ
            </p>
          </Section>

          <Section number="3" title="วัตถุประสงค์และฐานทางกฎหมาย">
            <ul style={listStyle}>
              <li><strong>ให้บริการเข้าสู่ระบบ จอง เช่า รับชำระมัดจำ และแจ้งสถานะการจอง:</strong> ฐานความจำเป็นเพื่อการปฏิบัติตามสัญญา หรือดำเนินการตามคำขอของท่านก่อนเข้าทำสัญญา ตามมาตรา 24(3)</li>
              <li><strong>ตรวจสอบสลิป ป้องกันการทุจริต ป้องกันการใช้สลิปซ้ำ และรักษาความปลอดภัยของระบบ:</strong> ฐานประโยชน์โดยชอบด้วยกฎหมาย โดยคำนึงถึงสิทธิและเสรีภาพของท่าน</li>
              <li><strong>การตลาดหรือการแชร์ข้อมูลเพื่อวัตถุประสงค์ที่ไม่จำเป็นต่อบริการ:</strong> เว็บไซต์นี้จะขอความยินยอมแยกต่างหากก่อนดำเนินการ และท่านถอนความยินยอมได้ทุกเมื่อ</li>
            </ul>
          </Section>

          <Section number="4" title="การเปิดเผยข้อมูลและผู้ให้บริการ">
            <p style={{ margin: 0 }}>เราเปิดเผยข้อมูลเท่าที่จำเป็นแก่ผู้ให้บริการที่ช่วยดำเนินระบบ ดังนี้</p>
            <ul style={listStyle}>
              <li><strong>Supabase:</strong> ฐานข้อมูล การยืนยันตัวตน และพื้นที่จัดเก็บไฟล์สลิป</li>
              <li><strong>LINE:</strong> การเข้าสู่ระบบด้วย LINE และการส่งข้อความแจ้งเตือนเกี่ยวกับการจอง</li>
              <li><strong>Google Sheets ผ่าน Google Apps Script:</strong> เฉพาะเมื่อผู้ดูแลระบบเปิดใช้การซิงก์ โดยอาจได้รับชื่อ เบอร์โทร และรายละเอียดการจอง แต่ไม่รวมรูปสลิป</li>
              <li><strong>SlipOK:</strong> เฉพาะเมื่อเปิดใช้การตรวจสลิปอัตโนมัติ โดยได้รับรูปสลิปและยอดเงินเพื่อยืนยันการชำระเงิน</li>
            </ul>
            <p style={{ margin: "12px 0 0" }}>เราไม่ขายข้อมูลส่วนบุคคล และจะไม่เปิดเผยให้พาร์ตเนอร์เพื่อการตลาด เว้นแต่ได้รับความยินยอมจากท่านก่อน</p>
          </Section>

          <Section number="5" title="การโอนข้อมูลไปต่างประเทศ">
            <p style={{ margin: 0 }}>
              ผู้ให้บริการ cloud และแพลตฟอร์มบางรายอาจประมวลผลข้อมูลนอกประเทศไทยตามภูมิภาคที่ผู้ให้บริการกำหนด เราจะโอนหรืออนุญาตให้ประมวลผลเท่าที่จำเป็นต่อบริการ และจัดให้มีมาตรการคุ้มครองที่เหมาะสมตาม PDPA ท่านสามารถติดต่อเราเพื่อขอข้อมูลเพิ่มเติมเกี่ยวกับผู้รับข้อมูลได้
            </p>
          </Section>

          <Section number="6" title="ระยะเวลาเก็บรักษาข้อมูล">
            <p style={{ margin: 0 }}>
              เราเก็บข้อมูลบัญชี การจอง และหลักฐานการชำระเงินตราบเท่าที่จำเป็นต่อการให้บริการ การติดตามสถานะ การระงับข้อพิพาท การตรวจสอบ และการปฏิบัติตามกฎหมาย เมื่อหมดความจำเป็น เราจะลบ ทำลาย หรือทำให้ข้อมูลไม่สามารถระบุตัวบุคคลได้ โดยอาจเก็บไว้ต่อเท่าที่กฎหมายหรือการใช้สิทธิเรียกร้องกำหนด
            </p>
          </Section>

          <Section number="7" title="สิทธิของเจ้าของข้อมูลส่วนบุคคล">
            <p style={{ margin: 0 }}>ภายใต้เงื่อนไขตามกฎหมาย ท่านมีสิทธิขอเข้าถึง ขอรับสำเนา/โอนย้าย แก้ไข ลบ ระงับการใช้ คัดค้านการประมวลผล และถอนความยินยอมในกรณีที่เราอาศัยความยินยอม ท่านสามารถยื่นคำขอได้ทาง LINE @CRABBY4RENT โดยเราอาจขอข้อมูลเท่าที่จำเป็นเพื่อยืนยันตัวตนก่อนดำเนินการ</p>
          </Section>

          <Section number="8" title="ความมั่นคงปลอดภัยและเหตุละเมิดข้อมูล">
            <p style={{ margin: 0 }}>
              เราใช้มาตรการทางเทคนิคและการจัดการที่เหมาะสม เช่น การควบคุมสิทธิ์เข้าถึง การยืนยันตัวตน และการใช้ลิงก์ชั่วคราวสำหรับดูสลิป เพื่อป้องกันการเข้าถึง ใช้ เปิดเผย เปลี่ยนแปลง หรือสูญหายโดยมิชอบ หากเกิดเหตุละเมิดข้อมูล เราจะดำเนินการตาม PDPA รวมถึงแจ้งสำนักงานคณะกรรมการคุ้มครองข้อมูลส่วนบุคคลภายในระยะเวลาที่กฎหมายกำหนด และแจ้งท่านโดยไม่ชักช้าเมื่อเหตุมีความเสี่ยงสูงต่อสิทธิและเสรีภาพของท่าน
            </p>
          </Section>

          <Section number="9" title="คุกกี้ที่จำเป็น">
            <p style={{ margin: 0 }}>
              เว็บไซต์ใช้เฉพาะคุกกี้ที่จำเป็นต่อการเข้าสู่ระบบและความปลอดภัยของบริการ เช่น{" "}
              <span style={codeStyle}>app_session</span>,{" "}
              <span style={codeStyle}>app_user_id</span>,{" "}
              <span style={codeStyle}>line_sub</span>,{" "}
              <span style={codeStyle}>line_oauth_state</span> และ{" "}
              <span style={codeStyle}>line_oauth_nonce</span>
              {" "}เพื่อรักษาสถานะการใช้งานและป้องกันการโจมตีระหว่างการเข้าสู่ระบบ เว็บไซต์ปัจจุบันไม่มีคุกกี้วิเคราะห์หรือโฆษณา หากมีการเพิ่มในอนาคต เราจะขอความยินยอมก่อนตั้งค่าคุกกี้ดังกล่าว
            </p>
          </Section>

          <Section number="10" title="การเปลี่ยนแปลงนโยบาย">
            <p style={{ margin: 0 }}>
              เราอาจทบทวนหรือปรับปรุงนโยบายนี้เมื่อบริการหรือกฎหมายเปลี่ยนแปลง โดยจะแสดงวันที่ปรับปรุงล่าสุดบนหน้านี้ เอกสารฉบับนี้จัดทำเพื่อใช้เป็นแนวทางเบื้องต้น และควรให้ที่ปรึกษากฎหมายตรวจทานก่อนเผยแพร่ใช้งานจริง
            </p>
          </Section>
        </article>
      </div>
      <Footer />
    </main>
  );
}
