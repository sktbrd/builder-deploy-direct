import { NextResponse } from "next/server";
import { signState } from "@/lib/oauth-state";

export const runtime = "nodejs";

export function GET(req: Request) {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const redirectUri = process.env.GITHUB_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: "GitHub OAuth env vars not configured" },
      { status: 500 },
    );
  }
  const next = new URL(req.url).searchParams.get("next") ?? undefined;
  const state = signState({ next });

  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "public_repo read:user");
  url.searchParams.set("state", state);

  return NextResponse.redirect(url);
}
