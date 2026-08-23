import { NextResponse } from "next/server";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set("app_session", "", { path: "/", maxAge: 0 });
  res.cookies.set("app_user_id", "", { path: "/", maxAge: 0 });
  res.cookies.set("line_sub", "", { path: "/", maxAge: 0 });
  return res;
}