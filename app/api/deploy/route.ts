import { NextResponse } from "next/server";
import type { DeployConfig } from "@/lib/config";
import {
  createProject,
  latestDeployment,
  VercelApiError,
} from "@/lib/vercel";

export const runtime = "nodejs";

type Body = { token: string; config: DeployConfig };

export async function POST(req: Request) {
  const { token, config } = (await req.json()) as Body;
  if (!token || !config) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  try {
    const project = await createProject(token, config);
    // Vercel auto-creates a deployment when the project is linked to a Git repo.
    // It may not be visible for a moment — poll up to ~10s.
    let deployment = null;
    for (let i = 0; i < 10; i++) {
      deployment = await latestDeployment(token, project.id, config.teamId);
      if (deployment) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    return NextResponse.json({
      projectId: project.id,
      projectName: project.name,
      teamId: config.teamId ?? null,
      deployment,
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
