import type { DeployConfig } from "./config";

const API = "https://api.vercel.com";

export class VercelApiError extends Error {
  constructor(
    public status: number,
    public code: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

async function api<T>(
  path: string,
  token: string,
  init?: RequestInit & { teamId?: string },
): Promise<T> {
  const url = new URL(`${API}${path}`);
  if (init?.teamId) url.searchParams.set("teamId", init.teamId);
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = body.error as { code?: string; message?: string } | undefined;
    throw new VercelApiError(
      res.status,
      err?.code,
      err?.message ?? `Vercel API ${res.status} ${res.statusText}`,
    );
  }
  return body as T;
}

export type VercelUser = {
  user: { id: string; username: string; email: string; name?: string };
};

export const validateToken = (token: string) =>
  api<VercelUser>("/v2/user", token);

export type VercelTeam = { id: string; slug: string; name: string };
export const listTeams = (token: string) =>
  api<{ teams: VercelTeam[] }>("/v2/teams", token);

export function parseGithubRepo(input: string): string {
  const trimmed = input.trim().replace(/\/$/, "");
  const m = trimmed.match(/(?:github\.com[:/])?([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
  if (!m) throw new Error(`Could not parse GitHub repo from "${input}"`);
  return m[1];
}

export type CreateProjectResult = {
  id: string;
  name: string;
  accountId: string;
  link?: { repo?: string; repoId?: number };
};

export async function createProject(
  token: string,
  config: DeployConfig,
): Promise<CreateProjectResult> {
  const repo = parseGithubRepo(config.githubRepo);
  const environmentVariables = Object.entries(config.env)
    .filter(([, v]) => v != null && v !== "")
    .map(([key, value]) => ({
      key,
      value,
      type: "encrypted" as const,
      target: ["production", "preview", "development"] as const,
    }));

  return api<CreateProjectResult>("/v11/projects", token, {
    method: "POST",
    teamId: config.teamId,
    body: JSON.stringify({
      name: config.projectName,
      framework: "nextjs",
      gitRepository: { repo, type: "github" },
      environmentVariables,
    }),
  });
}

export type Deployment = {
  uid: string;
  url: string;
  readyState:
    | "QUEUED"
    | "INITIALIZING"
    | "BUILDING"
    | "READY"
    | "ERROR"
    | "CANCELED";
  inspectorUrl?: string;
};

export async function latestDeployment(
  token: string,
  projectId: string,
  teamId?: string,
): Promise<Deployment | null> {
  const data = await api<{ deployments: Deployment[] }>(
    `/v6/deployments?projectId=${projectId}&limit=1`,
    token,
    { teamId },
  );
  return data.deployments[0] ?? null;
}

export const getDeployment = (token: string, id: string, teamId?: string) =>
  api<Deployment>(`/v13/deployments/${id}`, token, { teamId });