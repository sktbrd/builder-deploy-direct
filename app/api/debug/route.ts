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

export async function GET(req: Request) {
  // Read-only diagnostics for local development only. Never expose account
  // metadata (or, as a previous version did, create real deployments) in prod.
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const vercel = await readSession();
  const gh = await readGhSession();
  if (!vercel) {
    return NextResponse.json({ error: "Vercel not connected" }, { status: 401 });
  }

  const projectName = new URL(req.url).searchParams.get("project");

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

  return NextResponse.json(probes, {
    headers: { "Cache-Control": "no-store" },
  });
}
