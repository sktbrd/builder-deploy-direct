import { NextResponse } from "next/server";
import { signState } from "@/lib/oauth-state";

export const runtime = "nodejs";

export function GET(req: Request) {
  const slug = process.env.VERCEL_INTEGRATION_SLUG;
  if (!slug) {
    return NextResponse.json(
      { error: "VERCEL_INTEGRATION_SLUG not configured" },
      { status: 500 },
    );
  }
  const next = new URL(req.url).searchParams.get("next") ?? undefined;
  // Signed CSRF state — Vercel echoes `state` back to the redirect URL.
  const state = signState({ next });

  const url = new URL(`https://vercel.com/integrations/${slug}/new`);
  url.searchParams.set("state", state);
  return NextResponse.redirect(url.toString());
}
