import type { Metadata } from "next";
import { Geist, Geist_Mono, Itim } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const itim = Itim({
  weight: "400",
  subsets: ["thai", "latin"],
  variable: "--font-itim",
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
        className={`${geistSans.variable} ${geistMono.variable} ${itim.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
