import { NextResponse } from "next/server";
import { getDeployment, VercelApiError } from "@/lib/vercel";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { token, deploymentId, teamId } = (await req.json()) as {
    token?: string;
    deploymentId?: string;
    teamId?: string;
  };
  if (!token || !deploymentId) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  try {
    const deployment = await getDeployment(token, deploymentId, teamId);
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
