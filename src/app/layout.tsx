import type { Metadata } from "next";
import { Geist, Geist_Mono, Noto_Sans_Thai, IBM_Plex_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const notoSansThai = Noto_Sans_Thai({
  weight: ["400", "500", "600", "700", "800"],
  subsets: ["thai", "latin"],
  variable: "--font-noto-thai",
});

const plexMono = IBM_Plex_Mono({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: "Crabby เช่ามือถือ",
  description: "เช่ามือถือกับ Crabby",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${notoSansThai.variable} ${plexMono.variable} antialiased`}
      >
        {children}
        {/* นับจำนวนผู้เข้าชม/หน้าที่เปิด ผ่าน Vercel Analytics
            เก็บแบบไม่ระบุตัวบุคคล ไม่ใช้คุกกี้ และไม่ผูกกับบัญชีลูกค้า */}
        <Analytics />
      </body>
    </html>
  );
}
