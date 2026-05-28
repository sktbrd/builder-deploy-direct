export class GitHubApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function gh<T>(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new GitHubApiError(
      res.status,
      typeof body.message === "string"
        ? body.message
        : `GitHub API ${res.status} ${res.statusText}`,
    );
  }
  return body as T;
}

export type GhUser = { login: string; id: number; email?: string | null };

export const getGhUser = (token: string) => gh<GhUser>("/user", token);

export async function exchangeGhCode(params: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<{ access_token: string; scope: string; token_type: string }> {
  const body = new URLSearchParams({
    client_id: params.clientId,
    client_secret: params.clientSecret,
    code: params.code,
    redirect_uri: params.redirectUri,
  });
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = (await res.json()) as {
    access_token?: string;
    scope?: string;
    token_type?: string;
    error?: string;
    error_description?: string;
  };
  if (!data.access_token) {
    throw new GitHubApiError(
      400,
      data.error_description ?? data.error ?? "GitHub OAuth exchange failed",
    );
  }
  return {
    access_token: data.access_token,
    scope: data.scope ?? "",
    token_type: data.token_type ?? "bearer",
  };
}

export type GhRepo = {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  default_branch: string;
  owner: { login: string };
};

export async function forkRepo(
  token: string,
  sourceRepo: string,
  newName?: string,
): Promise<GhRepo> {
  const [owner, repo] = sourceRepo.split("/");
  if (!owner || !repo) throw new Error(`Bad source repo "${sourceRepo}"`);
  return gh<GhRepo>(`/repos/${owner}/${repo}/forks`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(newName ? { name: newName } : {}),
  });
}

export const getRepo = (token: string, fullName: string) =>
  gh<GhRepo>(`/repos/${fullName}`, token);

export async function commitFile(
  token: string,
  fullRepo: string,
  path: string,
  content: string,
  message: string,
  branch = "main",
): Promise<void> {
  let sha: string | undefined;
  try {
    const existing = await gh<{ sha: string }>(
      `/repos/${fullRepo}/contents/${encodeURIComponent(path)}?ref=${branch}`,
      token,
    );
    sha = existing.sha;
  } catch (e) {
    if (!(e instanceof GitHubApiError && e.status === 404)) throw e;
  }
  await gh(`/repos/${fullRepo}/contents/${encodeURIComponent(path)}`, token, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      content: Buffer.from(content).toString("base64"),
      branch,
      ...(sha ? { sha } : {}),
    }),
  });
}
