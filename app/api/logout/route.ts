import { NextResponse } from "next/server";

export const runtime = "nodejs";

type LogoutTarget = "all" | "vercel" | "github";

export async function POST(req: Request) {
  const { target = "all" } = (await req
    .json()
    .catch(() => ({}))) as { target?: LogoutTarget };

  const res = NextResponse.json({ ok: true });
  if (target === "all" || target === "vercel") {
    res.cookies.delete("vercel_token");
    res.cookies.delete("vercel_session");
  }
  if (target === "all" || target === "github") {
    res.cookies.delete("gh_token");
    res.cookies.delete("gh_session");
  }
  return res;
}
