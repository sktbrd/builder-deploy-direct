import { cookies } from "next/headers";

export type Session = {
  token: string;
  teamId: string | null;
};

export type GhSession = {
  token: string;
  login: string;
  // Present in GitHub App mode — the user's installation of our App. Used to
  // mint repo-scoped installation tokens for fork + trigger commit.
  installationId?: string;
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
    const session = JSON.parse(sessionRaw) as {
      login: string;
      installationId?: string;
    };
    return {
      token,
      login: session.login,
      installationId: session.installationId,
    };
  } catch {
    return null;
  }
}

// Resolves the token to use for repo operations (fork, commit). In GitHub App
// mode that's a fresh, repo-scoped installation token; otherwise the user's
// OAuth token. Imported lazily by routes to avoid a cycle at module load.
export async function repoToken(session: GhSession): Promise<string> {
  if (session.installationId) {
    const { getInstallationToken } = await import("./github-app");
    return getInstallationToken(session.installationId);
  }
  return session.token;
}
