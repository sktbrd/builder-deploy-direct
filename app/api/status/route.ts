import { NextResponse } from "next/server";
import { getDeployment, latestDeployment, VercelApiError } from "@/lib/vercel";
import { readSession } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: "Not connected" }, { status: 401 });
  }
  const { deploymentId, projectId } = (await req.json()) as {
    deploymentId?: string;
    projectId?: string;
  };
  if (!deploymentId && !projectId) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  try {
    // Prefer a known deployment id. Otherwise discover the project's latest
    // deployment — this is how the client recovers when the webhook-triggered
    // build hadn't appeared yet at deploy time (deployment may be null).
    const deployment = deploymentId
      ? await getDeployment(
          session.token,
          deploymentId,
          session.teamId ?? undefined,
        )
      : await latestDeployment(
          session.token,
          projectId!,
          session.teamId ?? undefined,
        );
    return NextResponse.json({ deployment });
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
