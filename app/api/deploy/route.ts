import { NextResponse } from "next/server";
import type { DeployConfig } from "@/lib/config";
import {
  createProject,
  latestDeployment,
  deleteProject,
  VercelApiError,
} from "@/lib/vercel";
import { commitFile, GitHubApiError } from "@/lib/github";
import { readSession, readGhSession } from "@/lib/session";

export const runtime = "nodejs";

type Body = {
  config: Omit<DeployConfig, "teamId">;
  repoId?: number;
};

export async function POST(req: Request) {
  const session = await readSession();
  const gh = await readGhSession();
  if (!session) {
    return NextResponse.json({ error: "Not connected" }, { status: 401 });
  }
  if (!gh) {
    return NextResponse.json(
      { error: "GitHub not connected" },
      { status: 401 },
    );
  }
  const { config } = (await req.json()) as Body;
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

    // Integration OAuth tokens don't reliably have permission to trigger
    // production deployments via /v13/deployments. Instead, push a tiny
    // commit to the fork's main — Vercel's GitHub webhook then fires the
    // build with the project's own (full) permissions.
    try {
      await commitFile(
        gh.token,
        config.githubRepo,
        ".vercel-deploy-trigger",
        `Triggered at ${new Date().toISOString()}\n`,
        "chore: trigger initial Vercel deploy",
      );
    } catch (e) {
      if (e instanceof GitHubApiError) {
        throw new Error(`Couldn't push trigger commit: ${e.message}`);
      }
      throw e;
    }

    // Poll for the deployment to appear — webhook delivery is async.
    let deployment = null;
    for (let i = 0; i < 30; i++) {
      deployment = await latestDeployment(
        session.token,
        project.id,
        session.teamId ?? undefined,
      );
      if (deployment) break;
      await new Promise((r) => setTimeout(r, 1000));
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
      } catch {}
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
