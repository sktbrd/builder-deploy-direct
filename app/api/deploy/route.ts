import { NextResponse } from "next/server";
import type { DeployConfig } from "@/lib/config";
import {
  createProject,
  triggerDeployment,
  latestDeployment,
  deleteProject,
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

  const fullConfig: DeployConfig = {
    ...config,
    teamId: session.teamId ?? undefined,
  };

  let createdProjectId: string | null = null;
  try {
    const project = await createProject(session.token, fullConfig);
    createdProjectId = project.id;

    let deployment;
    try {
      deployment = await triggerDeployment(session.token, {
        projectName: project.name,
        projectId: project.id,
        repoId: repoId ?? project.link?.repoId,
        repo: config.githubRepo,
        ref: "main",
        teamId: session.teamId ?? undefined,
        target: "production",
      });
    } catch (triggerErr) {
      // Maybe webhook fired in the meantime — poll for an existing deployment.
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
    // Roll back the orphaned project so the next attempt can reuse the name.
    if (createdProjectId) {
      try {
        await deleteProject(
          session.token,
          createdProjectId,
          session.teamId ?? undefined,
        );
      } catch {
        // best-effort cleanup; ignore
      }
    }
    if (e instanceof VercelApiError) {
      return NextResponse.json(
        { error: e.message, code: e.code, rolledBack: !!createdProjectId },
        { status: e.status },
      );
    }
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "Unknown error",
        rolledBack: !!createdProjectId,
      },
      { status: 500 },
    );
  }
}
