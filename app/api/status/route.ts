import { NextResponse } from "next/server";
import { getDeployment, VercelApiError } from "@/lib/vercel";
import { readSession } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: "Not connected" }, { status: 401 });
  }
  const { deploymentId } = (await req.json()) as { deploymentId?: string };
  if (!deploymentId) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  try {
    const deployment = await getDeployment(
      session.token,
      deploymentId,
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
