# Builder Deploy Direct

A no-code launcher that deploys [sktbrd/builder-template-app](https://github.com/sktbrd/builder-template-app) — a [Builder DAO](https://nouns.build) front-end — straight into a user's **own GitHub + Vercel accounts**. The user authorizes both providers via OAuth, fills in their DAO config, and watches the build go live, all without leaving the page.

---

## How it works

The whole flow is a single client-side wizard ([`app/page.tsx`](app/page.tsx)) backed by a handful of Next.js API routes. The set of steps is assembled dynamically based on what's already connected.

1. **Connect Vercel** — OAuth via the Vercel integration. `/api/vercel/install` → Vercel → `/api/vercel/callback`. The access token is stored in an **httpOnly** cookie (never reaches client JS); a separate non-httpOnly cookie holds display info (username, team).
2. **Connect GitHub** — **GitHub App** install when `GITHUB_APP_*` env is set (repo-scoped installation tokens for fork + trigger commit), or an OAuth App (`public_repo read:user`) as fallback. `/api/github/install` → GitHub → `/api/github/callback`. Same cookie split; in App mode the session also carries the installation id.
3. **Bridge** — the user installs the Vercel GitHub app so Vercel can read their fork. We verify access via `/api/vercel/check-github` before continuing (with a "continue anyway" escape hatch).
4. **Fork** — `/api/github/fork` calls `POST /repos/{template}/forks` into the user's account, reusing an existing fork if present, polling until GitHub finishes creating it.
5. **Configure** — project name (debounced availability check), chain, DAO token address, WalletConnect ID, plus optional Alchemy / Pinata / site-URL.
6. **Deploy** — see below.
7. **Watch** — the client polls until the deployment is `READY`, then shows the live URL.

All Vercel calls go through [`lib/vercel.ts`](lib/vercel.ts); GitHub through [`lib/github.ts`](lib/github.ts). OAuth CSRF `state` is signed/verified in [`lib/oauth-state.ts`](lib/oauth-state.ts).

### The deploy step (the important bit)

`/api/deploy` does **two** things:

1. `POST /v11/projects` — creates the Vercel project, linked to the fork, with all env vars written as `encrypted`.
2. **Pushes a tiny commit** (`.vercel-deploy-trigger`) to the fork's `main` using the user's GitHub token.

Why the commit instead of `POST /v13/deployments`? Integration OAuth tokens don't reliably have permission to trigger production deployments through the deployments API. Pushing a commit makes Vercel's own GitHub webhook fire the build with the **project's** full permissions. The server then polls for the deployment to appear and returns it.

Because the webhook round-trip is async, the deployment often hasn't materialized by the time `/api/deploy` returns. The client handles this by polling `/api/status` **by `projectId`** until a deployment exists, then by its `uid` until `READY` — so the final live URL always shows up, even on a slow first build. On failure, the orphaned project is rolled back so the name can be reused.

---

## Local dev

```bash
pnpm install
cp .env.example .env.local   # then fill in the values (see below)
pnpm dev
```

Open <http://localhost:3000>.

### Required environment variables

See [`.env.example`](.env.example) for the full list with links. In short you need:

- A **GitHub OAuth App** → `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_REDIRECT_URI`
- A **Vercel integration** → `VERCEL_CLIENT_ID`, `VERCEL_CLIENT_SECRET`, `VERCEL_REDIRECT_URI`, `VERCEL_INTEGRATION_SLUG`
- `TEMPLATE_REPO` (e.g. `sktbrd/builder-template-app`)
- `OAUTH_STATE_SECRET` (random; `openssl rand -hex 32`)

Each provider's configured callback/redirect URL must match the matching `*_REDIRECT_URI` value exactly.

---

## Project layout

```
app/
  page.tsx                     — the entire wizard UI + polling logic
  api/
    vercel/install,callback    — Vercel OAuth (state-signed)
    vercel/check-github        — verifies Vercel can see the user's GitHub
    vercel/check-name          — project-name availability
    github/install,callback    — GitHub OAuth (state-signed)
    github/fork                — forks the template into the user's account
    deploy                     — creates project + triggers build via commit
    status                     — polls a deployment by id or projectId
    me / logout                — session read / clear
    debug                      — read-only diagnostics (dev only)
lib/
  config.ts                    — env keys, chain options, DeployConfig
  vercel.ts                    — Vercel API client
  github.ts                    — GitHub API client
  oauth-state.ts               — signed CSRF state
  redirect.ts                  — same-origin redirect guard
  session.ts                   — cookie session readers
```

---

## Security notes

- **Tokens live in httpOnly cookies**, never in client JS. Logout (`/api/logout`) clears them.
- **OAuth `state` is HMAC-signed** with a TTL. GitHub callbacks require valid state; Vercel callbacks reject an *invalid* state but tolerate a *missing* one (some install flows don't forward it) — so a forged callback is always blocked, but users can't get locked out.
- **Redirects are same-origin only** (`lib/redirect.ts`) — no open-redirect via `next`.
- **`/api/debug` is disabled in production** and performs no side effects (it only reads).
- **GitHub access is explained before auth** (what we fork + the single trigger commit) and a revoke link is offered after deploy.
- **GitHub App mode** (when configured) issues repo-scoped installation tokens, so the deployer only touches the selected fork. The **OAuth App fallback** uses `public_repo`, which grants write to all of the user's public repos — set the `GITHUB_APP_*` env to avoid it.

---

## Known limitations / future work

- **No cancel/rollback UI** during a build (`POST /v12/deployments/{id}/cancel` could power one).
- **Single template.** The env fields are hard-coded for the Builder template; parsing `sample.env` from the fork would make it generic.
- **`.vercel-deploy-trigger`** is left in the fork after deploy.

---

## License

MIT
