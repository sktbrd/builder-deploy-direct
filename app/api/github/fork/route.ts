import { NextResponse } from "next/server";
import { forkRepo, getRepo, GitHubApiError } from "@/lib/github";
import { readGhSession } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await readGhSession();
  if (!session) {
    return NextResponse.json({ error: "Not connected to GitHub" }, { status: 401 });
  }
  const source = process.env.TEMPLATE_REPO;
  if (!source) {
    return NextResponse.json(
      { error: "TEMPLATE_REPO not configured" },
      { status: 500 },
    );
  }

  const { name } = (await req.json().catch(() => ({}))) as { name?: string };
  const sourceName = source.split("/")[1];
  const targetName = name || sourceName;
  const targetFullName = `${session.login}/${targetName}`;

  try {
    // If the user already forked it, return that directly.
    try {
      const existing = await getRepo(session.token, targetFullName);
      return NextResponse.json({ repo: existing, alreadyExisted: true });
    } catch (e) {
      if (!(e instanceof GitHubApiError) || e.status !== 404) throw e;
    }

    const repo = await forkRepo(session.token, source, name);
    // GitHub fork creation is async — the repo may not be immediately usable.
    // Poll for readiness up to ~10s.
    for (let i = 0; i < 10; i++) {
      try {
        const ready = await getRepo(session.token, repo.full_name);
        return NextResponse.json({ repo: ready, alreadyExisted: false });
      } catch {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    return NextResponse.json({ repo, alreadyExisted: false });
  } catch (e) {
    if (e instanceof GitHubApiError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}
