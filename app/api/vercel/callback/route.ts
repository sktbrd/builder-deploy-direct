import { NextResponse } from "next/server";
import { exchangeCode, validateToken, VercelApiError } from "@/lib/vercel";
import { verifyState } from "@/lib/oauth-state";
import { safeNext } from "@/lib/redirect";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const teamIdParam = url.searchParams.get("teamId");

  if (!code) {
    return NextResponse.json({ error: "Missing code" }, { status: 400 });
  }

  // Soft-fail CSRF check: a *present but invalid* state is always rejected,
  // but a totally missing state is allowed (some Vercel install flows may not
  // forward it) so we never lock users out of connecting.
  let next: string | null = null;
  if (stateParam) {
    const stateCheck = verifyState(stateParam);
    if (!stateCheck.ok) {
      return NextResponse.json(
        { error: `Invalid state (${stateCheck.reason})` },
        { status: 400 },
      );
    }
    next = stateCheck.next ?? null;
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

    const res = NextResponse.redirect(new URL(safeNext(next), url.origin));
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
