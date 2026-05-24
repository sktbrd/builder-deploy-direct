import { NextResponse } from "next/server";
import { exchangeCode, validateToken, VercelApiError } from "@/lib/vercel";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next");
  const teamIdParam = url.searchParams.get("teamId");

  if (!code) {
    return NextResponse.json({ error: "Missing code" }, { status: 400 });
  }

  const clientId = process.env.VERCEL_CLIENT_ID;
  const clientSecret = process.env.VERCEL_CLIENT_SECRET;
  const redirectUri = process.env.VERCEL_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.json(
      { error: "OAuth env vars not configured" },
      { status: 500 },
    );
  }

  try {
    const tok = await exchangeCode({
      code,
      clientId,
      clientSecret,
      redirectUri,
    });
    const me = await validateToken(tok.access_token);

    const res = NextResponse.redirect(
      next ? new URL(next, url.origin) : new URL("/", url.origin),
    );
    const isProd = process.env.NODE_ENV === "production";
    // 30-day session. Cookie is httpOnly so the token never reaches client JS.
    const cookieOpts = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: isProd,
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    };
    res.cookies.set("vercel_token", tok.access_token, cookieOpts);
    res.cookies.set(
      "vercel_session",
      JSON.stringify({
        teamId: tok.team_id ?? teamIdParam ?? null,
        userId: tok.user_id,
        installationId: tok.installation_id,
        username: me.user.username,
        email: me.user.email,
      }),
      { ...cookieOpts, httpOnly: false },
    );
    return res;
  } catch (e) {
    if (e instanceof VercelApiError) {
      return NextResponse.json(
        { error: e.message, code: e.code },
        { status: e.status },
      );
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}
