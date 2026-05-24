import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export const runtime = "nodejs";

export async function GET() {
  const jar = await cookies();
  const vercelSession = jar.get("vercel_session")?.value;
  const vercelToken = jar.get("vercel_token")?.value;
  const ghSession = jar.get("gh_session")?.value;
  const ghToken = jar.get("gh_token")?.value;

  let vercel: Record<string, unknown> | null = null;
  if (vercelSession && vercelToken) {
    try {
      vercel = JSON.parse(vercelSession);
    } catch {}
  }

  let github: Record<string, unknown> | null = null;
  if (ghSession && ghToken) {
    try {
      github = JSON.parse(ghSession);
    } catch {}
  }

  return NextResponse.json({
    vercel: vercel ? { connected: true, ...vercel } : { connected: false },
    github: github ? { connected: true, ...github } : { connected: false },
  });
}
