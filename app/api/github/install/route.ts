import { NextResponse } from "next/server";
import { signState } from "@/lib/oauth-state";
import { appConfigured } from "@/lib/github-app";

export const runtime = "nodejs";

export function GET(req: Request) {
  const next = new URL(req.url).searchParams.get("next") ?? undefined;
  const state = signState({ next });

  // GitHub App mode: send the user to install the App (they pick the account
  // and, optionally, just the fork repo). With "Request user authorization
  // during installation" enabled, the callback also receives an OAuth `code`.
  if (appConfigured()) {
    const url = new URL(
      `https://github.com/apps/${process.env.GITHUB_APP_SLUG}/installations/new`,
    );
    url.searchParams.set("state", state);
    return NextResponse.redirect(url);
  }

  // OAuth App fallback (broad public_repo scope).
  const clientId = process.env.GITHUB_CLIENT_ID;
  const redirectUri = process.env.GITHUB_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: "GitHub OAuth env vars not configured" },
      { status: 500 },
    );
  }
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "public_repo read:user");
  url.searchParams.set("state", state);
  return NextResponse.redirect(url);
}
