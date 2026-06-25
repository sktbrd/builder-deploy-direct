import { NextResponse } from "next/server";
import { exchangeGhCode, getGhUser, GitHubApiError } from "@/lib/github";
import { verifyState } from "@/lib/oauth-state";
import { safeNext } from "@/lib/redirect";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");

  if (!code) {
    return NextResponse.json({ error: "Missing code" }, { status: 400 });
  }
  const stateCheck = verifyState(stateParam);
  if (!stateCheck.ok) {
    return NextResponse.json(
      { error: `Invalid state (${stateCheck.reason})` },
      { status: 400 },
    );
  }
  const next = stateCheck.next;

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  const redirectUri = process.env.GITHUB_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.json(
      { error: "GitHub OAuth env vars not configured" },
      { status: 500 },
    );
  }

  try {
    const tok = await exchangeGhCode({
      code,
      clientId,
      clientSecret,
      redirectUri,
    });
    const user = await getGhUser(tok.access_token);

    const res = NextResponse.redirect(new URL(safeNext(next), url.origin));
    const isProd = process.env.NODE_ENV === "production";
    const cookieOpts = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: isProd,
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    };
    res.cookies.set("gh_token", tok.access_token, cookieOpts);
    res.cookies.set(
      "gh_session",
      JSON.stringify({ login: user.login, id: user.id }),
      { ...cookieOpts, httpOnly: false },
    );
    return res;
  } catch (e) {
    if (e instanceof GitHubApiError) {
      return NextResponse.json(
        { error: e.message },
        { status: e.status },
      );
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}
