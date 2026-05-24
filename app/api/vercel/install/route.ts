import { NextResponse } from "next/server";

export const runtime = "nodejs";

export function GET() {
  const slug = process.env.VERCEL_INTEGRATION_SLUG;
  if (!slug) {
    return NextResponse.json(
      { error: "VERCEL_INTEGRATION_SLUG not configured" },
      { status: 500 },
    );
  }
  return NextResponse.redirect(`https://vercel.com/integrations/${slug}/new`);
}
