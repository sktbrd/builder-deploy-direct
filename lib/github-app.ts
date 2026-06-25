import { createSign } from "node:crypto";
import { GitHubApiError } from "./github";

// GitHub App mode. When the GITHUB_APP_* env is present we authenticate as a
// scoped GitHub App (installation tokens limited to the repos the user selects)
// instead of an OAuth App with broad `public_repo`. If the env is absent the
// callers fall back to the existing OAuth flow, so this can ship dark.
export function appConfigured(): boolean {
  return Boolean(
    process.env.GITHUB_APP_ID &&
      process.env.GITHUB_APP_PRIVATE_KEY &&
      process.env.GITHUB_APP_CLIENT_ID &&
      process.env.GITHUB_APP_CLIENT_SECRET &&
      process.env.GITHUB_APP_SLUG,
  );
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

// Short-lived (10 min) RS256 JWT identifying the App itself. Signed locally
// with node:crypto — no external JWT dependency needed.
function appJwt(): string {
  const appId = process.env.GITHUB_APP_ID;
  // Support both real newlines and the "\n"-escaped form people paste into env UIs.
  const pem = (process.env.GITHUB_APP_PRIVATE_KEY ?? "").replace(/\\n/g, "\n");
  if (!appId || !pem) throw new Error("GitHub App credentials not configured");
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({ iat: now - 30, exp: now + 540, iss: appId }),
  );
  const data = `${header}.${payload}`;
  const sig = createSign("RSA-SHA256").update(data).sign(pem);
  return `${data}.${b64url(sig)}`;
}

async function ghApp<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${appJwt()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new GitHubApiError(
      res.status,
      typeof body.message === "string" ? body.message : `GitHub App ${res.status}`,
    );
  }
  return body as T;
}

// Mint a repo-scoped installation access token (used for fork + trigger commit).
export async function getInstallationToken(
  installationId: string,
): Promise<string> {
  const data = await ghApp<{ token: string }>(
    `/app/installations/${installationId}/access_tokens`,
    { method: "POST" },
  );
  return data.token;
}

// After user OAuth, find this App's installation for the signed-in user so we
// know which installation token to mint. Uses the user-to-server token.
export async function findUserInstallationId(
  userToken: string,
): Promise<string | null> {
  const res = await fetch("https://api.github.com/user/installations", {
    headers: {
      Authorization: `Bearer ${userToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  const data = (await res.json().catch(() => ({}))) as {
    installations?: { id: number; app_id: number }[];
  };
  if (!res.ok) return null;
  const appId = process.env.GITHUB_APP_ID;
  const inst = (data.installations ?? []).find(
    (i) => String(i.app_id) === String(appId),
  );
  return inst ? String(inst.id) : null;
}
