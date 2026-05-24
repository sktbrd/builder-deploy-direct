import { NextResponse } from "next/server";
import type { DeployConfig } from "@/lib/config";
import {
  createProject,
  triggerDeployment,
  latestDeployment,
  VercelApiError,
} from "@/lib/vercel";
import { readSession } from "@/lib/session";

export const runtime = "nodejs";

type Body = {
  config: Omit<DeployConfig, "teamId">;
  repoId?: number;
};

export async function POST(req: Request) {
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: "Not connected" }, { status: 401 });
  }
  const { config, repoId } = (await req.json()) as Body;
  if (!config) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  try {
    const fullConfig: DeployConfig = {
      ...config,
      teamId: session.teamId ?? undefined,
    };
    const project = await createProject(session.token, fullConfig);

    // POST /v11/projects only links the git repo; it doesn't always create
    // an initial deployment. Trigger one explicitly so the first build runs.
    let deployment;
    try {
      deployment = await triggerDeployment(session.token, {
        projectName: project.name,
        repoId: repoId ?? project.link?.repoId,
        repo: config.githubRepo,
        ref: "main",
        teamId: session.teamId ?? undefined,
      });
    } catch (triggerErr) {
      // If trigger fails, fall back to polling the latest deployment in case
      // Vercel kicked one off via webhook.
      for (let i = 0; i < 10; i++) {
        deployment = await latestDeployment(
          session.token,
          project.id,
          session.teamId ?? undefined,
        );
        if (deployment) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (!deployment) throw triggerErr;
    }

    return NextResponse.json({
      projectId: project.id,
      projectName: project.name,
      teamId: session.teamId,
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
