import { NextResponse } from "next/server";
import { projectExists, VercelApiError } from "@/lib/vercel";
import { readSession } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: "Not connected" }, { status: 401 });
  }
  const name = new URL(req.url).searchParams.get("name");
  if (!name) {
    return NextResponse.json({ error: "Missing name" }, { status: 400 });
  }
  try {
    const exists = await projectExists(
      session.token,
      name,
      session.teamId ?? undefined,
    );
    return NextResponse.json({ available: !exists });
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
