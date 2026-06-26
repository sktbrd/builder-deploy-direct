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

export type OauthTokenResponse = {
  token_type: "Bearer";
  access_token: string;
  installation_id: string;
  user_id: string;
  team_id: string | null;
};

export async function exchangeCode(params: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<OauthTokenResponse> {
  const body = new URLSearchParams({
    client_id: params.clientId,
    client_secret: params.clientSecret,
    code: params.code,
    redirect_uri: params.redirectUri,
  });
  const res = await fetch(`${API}/v2/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = data.error as { code?: string; message?: string } | undefined;
    throw new VercelApiError(
      res.status,
      err?.code,
      err?.message ?? `Vercel OAuth ${res.status} ${res.statusText}`,
    );
  }
  return data as OauthTokenResponse;
}

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

export const getProject = (
  token: string,
  idOrName: string,
  teamId?: string,
) =>
  api<CreateProjectResult>(
    `/v9/projects/${encodeURIComponent(idOrName)}`,
    token,
    { teamId },
  );

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

export type TriggerDeploymentOpts = {
  projectName: string;
  projectId?: string;
  ref?: string;
  repoId?: number;
  repo?: string;
  teamId?: string;
  target?: "production" | "staging";
};

export async function triggerDeployment(
  token: string,
  opts: TriggerDeploymentOpts,
): Promise<Deployment> {
  const gitSource: Record<string, unknown> = {
    type: "github",
    ref: opts.ref ?? "main",
  };
  if (opts.repoId) gitSource.repoId = opts.repoId;
  if (opts.repo) {
    const [org, name] = opts.repo.split("/");
    if (org && name) {
      gitSource.org = org;
      gitSource.repo = name;
    }
  }
  const body: Record<string, unknown> = {
    name: opts.projectName,
    gitSource,
    source: "import",
  };
  if (opts.projectId) body.project = opts.projectId;
  if (opts.target) body.target = opts.target;
  return api<Deployment>("/v13/deployments", token, {
    method: "POST",
    teamId: opts.teamId,
    body: JSON.stringify(body),
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
  // Assigned aliases (e.g. my-dao-site-nine.vercel.app). Present on v13 reads;
  // we surface the cleanest one instead of the hashed deployment url.
  alias?: string[];
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

export type GitNamespace = {
  id: string | number;
  slug: string;
  provider: string;
};

export const listGitNamespaces = (token: string, teamId?: string) =>
  api<GitNamespace[]>(`/v1/integrations/git-namespaces?host=github`, token, {
    teamId,
  });

export async function deleteProject(
  token: string,
  idOrName: string,
  teamId?: string,
): Promise<void> {
  await api<unknown>(`/v9/projects/${encodeURIComponent(idOrName)}`, token, {
    method: "DELETE",
    teamId,
  });
}

export async function projectExists(
  token: string,
  name: string,
  teamId?: string,
): Promise<boolean> {
  try {
    await api<{ id: string }>(
      `/v9/projects/${encodeURIComponent(name)}`,
      token,
      { teamId },
    );
    return true;
  } catch (e) {
    if (e instanceof VercelApiError && e.status === 404) return false;
    throw e;
  }
}