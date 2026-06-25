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
    const githubNs = namespaces.filter((n) => n.provider === "github");
    const matched = githubNs.find(
      (n) => n.slug.toLowerCase() === gh.login.toLowerCase(),
    );
    // Distinguish the failure modes so the UI can give a targeted fix.
    const reason = matched
      ? "ok"
      : githubNs.length === 0
        ? "no-github" // Vercel has no GitHub connection at all
        : "wrong-account"; // connected, but not to the account/org with the fork
    return NextResponse.json({
      hasBridge: Boolean(matched),
      reason,
      ghLogin: gh.login,
      githubNamespaces: githubNs.map((n) => n.slug),
      namespaces: namespaces.map((n) => ({ slug: n.slug, provider: n.provider })),
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
