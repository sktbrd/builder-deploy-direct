import { cookies } from "next/headers";

export type Session = {
  token: string;
  teamId: string | null;
};

export type GhSession = {
  token: string;
  login: string;
};

export async function readSession(): Promise<Session | null> {
  const jar = await cookies();
  const token = jar.get("vercel_token")?.value;
  const sessionRaw = jar.get("vercel_session")?.value;
  if (!token || !sessionRaw) return null;
  try {
    const session = JSON.parse(sessionRaw) as { teamId: string | null };
    return { token, teamId: session.teamId ?? null };
  } catch {
    return null;
  }
}

export async function readGhSession(): Promise<GhSession | null> {
  const jar = await cookies();
  const token = jar.get("gh_token")?.value;
  const sessionRaw = jar.get("gh_session")?.value;
  if (!token || !sessionRaw) return null;
  try {
    const session = JSON.parse(sessionRaw) as { login: string };
    return { token, login: session.login };
  } catch {
    return null;
  }
}
