import { NextResponse } from "next/server";
import { listGitNamespaces, VercelApiError } from "@/lib/vercel";
import { readSession, readGhSession } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  const vercel = await readSession();
  const gh = await readGhSession();
  if (!vercel) {
    return NextResponse.json({ error: "Vercel not connected" }, { status: 401 });
  }
  if (!gh) {
    return NextResponse.json({ error: "GitHub not connected" }, { status: 401 });
  }
  try {
    const namespaces = await listGitNamespaces(
      vercel.token,
      vercel.teamId ?? undefined,
    );
    const matched = namespaces.find(
      (n) => n.provider === "github" && n.slug.toLowerCase() === gh.login.toLowerCase(),
    );
    return NextResponse.json({
      hasBridge: Boolean(matched),
      namespaces: namespaces.map((n) => ({ slug: n.slug, provider: n.provider })),
      ghLogin: gh.login,
    });
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
