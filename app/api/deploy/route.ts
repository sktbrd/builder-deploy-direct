import { NextResponse } from "next/server";
import type { DeployConfig } from "@/lib/config";
import {
  createProject,
  getProject,
  latestDeployment,
  VercelApiError,
} from "@/lib/vercel";
import { commitFile, GitHubApiError } from "@/lib/github";
import { readSession, readGhSession, repoToken } from "@/lib/session";

export const runtime = "nodejs";

type Body = {
  config: Omit<DeployConfig, "teamId">;
  repoId?: number;
};

// Stages let the UI tailor recovery to where things actually broke.
type Stage = "create" | "trigger";

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
  const teamId = session.teamId ?? undefined;

  const fail = (stage: Stage, e: unknown, extra: Record<string, unknown> = {}) => {
    const status =
      e instanceof VercelApiError || e instanceof GitHubApiError
        ? e.status
        : 500;
    const code = e instanceof VercelApiError ? e.code : undefined;
    return NextResponse.json(
      {
        stage,
        error: e instanceof Error ? e.message : "Unknown error",
        code,
        ...extra,
      },
      { status },
    );
  };

  // ── Stage 1: create the project (idempotent — reuse on retry) ─────────────
  let project;
  try {
    project = await createProject(session.token, fullConfig);
  } catch (e) {
    const exists =
      e instanceof VercelApiError &&
      (e.status === 409 || /already exists|conflict/i.test(e.message));
    if (exists) {
      // A previous attempt created it (e.g. the trigger commit failed and the
      // user retried). Reuse it instead of erroring on the taken name.
      try {
        project = await getProject(session.token, config.projectName, teamId);
      } catch (e2) {
        return fail("create", e2);
      }
    } else {
      return fail("create", e);
    }
  }

  // ── Stage 2: trigger the build via a commit to the fork ───────────────────
  // Integration OAuth tokens can't reliably trigger production deploys through
  // /v13/deployments, so we push a tiny commit and let Vercel's webhook build
  // with the project's own permissions. The project already exists here, so on
  // failure we keep it (and return its id) rather than losing the link.
  try {
    await commitFile(
      await repoToken(gh),
      config.githubRepo,
      ".vercel-deploy-trigger",
      `Triggered at ${new Date().toISOString()}\n`,
      "chore: trigger initial Vercel deploy",
    );
  } catch (e) {
    return fail("trigger", e, {
      projectId: project.id,
      projectName: project.name,
      teamId: session.teamId,
    });
  }

  // ── Poll for the webhook-triggered deployment to appear ───────────────────
  // It may not arrive within the window; that's fine — the client keeps polling
  // by projectId and never treats a missing deployment as a hard failure.
  let deployment = null;
  for (let i = 0; i < 30; i++) {
    deployment = await latestDeployment(session.token, project.id, teamId);
    if (deployment) break;
    await new Promise((r) => setTimeout(r, 1000));
  }

  return NextResponse.json({
    projectId: project.id,
    projectName: project.name,
    teamId: session.teamId,
    deployment,
  });
}
