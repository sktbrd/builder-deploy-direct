import { NextResponse } from "next/server";
import { listTeams, validateToken, VercelApiError } from "@/lib/vercel";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { token } = (await req.json()) as { token?: string };
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }
  try {
    const [user, teamsRes] = await Promise.all([
      validateToken(token),
      listTeams(token).catch(() => ({ teams: [] })),
    ]);
    return NextResponse.json({
      user: user.user,
      teams: teamsRes.teams,
    });
  } catch (e) {
    if (e instanceof VercelApiError) {
      return NextResponse.json(
        { error: e.message, code: e.code },
        { status: e.status === 403 ? 403 : 401 },
      );
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}
