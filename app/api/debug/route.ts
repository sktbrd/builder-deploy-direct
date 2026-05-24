import { NextResponse } from "next/server";
import { readSession, readGhSession } from "@/lib/session";

export const runtime = "nodejs";

async function vercelGet(path: string, token: string, teamId?: string | null) {
  const url = new URL(`https://api.vercel.com${path}`);
  if (teamId) url.searchParams.set("teamId", teamId);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, body };
}

async function vercelPost(
  path: string,
  token: string,
  payload: unknown,
  teamId?: string | null,
) {
  const url = new URL(`https://api.vercel.com${path}`);
  if (teamId) url.searchParams.set("teamId", teamId);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, body };
}

export async function GET(req: Request) {
  const vercel = await readSession();
  const gh = await readGhSession();
  if (!vercel) {
    return NextResponse.json({ error: "Vercel not connected" }, { status: 401 });
  }

  const params = new URL(req.url).searchParams;
  const projectName = params.get("project");
  const repo = params.get("repo");
  const repoId = params.get("repoId");

  const probes: Record<string, unknown> = {};

  probes.session = {
    vercelTeamId: vercel.teamId,
    ghLogin: gh?.login ?? null,
  };

  // 1. Whoami
  probes.user = await vercelGet("/v2/user", vercel.token);

  // 2. Git namespaces (v1)
  probes.gitNamespacesV1 = await vercelGet(
    "/v1/integrations/git-namespaces?host=github",
    vercel.token,
    vercel.teamId,
  );

  // 3. Git namespaces (v9 alt)
  probes.gitNamespacesV9 = await vercelGet(
    "/v9/integrations/git-namespaces?host=github",
    vercel.token,
    vercel.teamId,
  );

  // 4. List integrations / configurations
  probes.configurations = await vercelGet(
    "/v1/integrations/configurations",
    vercel.token,
    vercel.teamId,
  );

  // 5. Project lookup (if requested)
  if (projectName) {
    probes.project = await vercelGet(
      `/v9/projects/${encodeURIComponent(projectName)}`,
      vercel.token,
      vercel.teamId,
    );
  }

  // 6. Try deployment probes if a repo + project given
  if (projectName && (repo || repoId)) {
    const gitSource: Record<string, unknown> = { type: "github", ref: "main" };
    if (repoId) gitSource.repoId = Number(repoId);
    if (repo) {
      const [org, name] = repo.split("/");
      if (org && name) {
        gitSource.org = org;
        gitSource.repo = name;
      }
    }

    probes.deployProbe_noTarget = await vercelPost(
      "/v13/deployments",
      vercel.token,
      { name: projectName, gitSource, source: "import" },
      vercel.teamId,
    );

    probes.deployProbe_staging = await vercelPost(
      "/v13/deployments",
      vercel.token,
      { name: projectName, gitSource, target: "staging", source: "import" },
      vercel.teamId,
    );

    probes.deployProbe_production = await vercelPost(
      "/v13/deployments",
      vercel.token,
      { name: projectName, gitSource, target: "production", source: "import" },
      vercel.teamId,
    );
  }

  return NextResponse.json(probes, {
    headers: { "Cache-Control": "no-store" },
  });
}
