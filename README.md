# Builder Deploy Direct

The "Option B" companion to [builder-launchpad](https://github.com/sktbrd/builder-launchpad).

This one deploys [sktbrd/builder-template-app](https://github.com/sktbrd/builder-template-app) **straight to the user's Vercel account via the API** — no copy-paste, no roundtrip to Vercel's UI. The user pastes a Vercel API token, fills the config, hits Deploy, and watches the build progress live.

---

## A vs B — pick what fits

| | [builder-launchpad](https://github.com/sktbrd/builder-launchpad) (A) | **builder-deploy-direct (B)** |
|---|---|---|
| Backend required | No | Yes (Next.js API routes) |
| User authenticates with Vercel | Yes, on vercel.com | Yes, via API token in our form |
| Env values pre-filled | ❌ user pastes a copy block | ✅ written via Vercel API |
| Deploy progress in our UI | ❌ user watches on vercel.com | ✅ live polled status |
| Prerequisites for user | Vercel account | Vercel account **+ a fork of the template in their own GitHub** |
| Complexity | A page of form code | Form + API routes + polling |

If you don't need pre-fill, A is leaner. If you want the full one-form-and-done UX, use B.

---

## How it works

1. **Connect** — user generates a Vercel API token at `vercel.com/account/settings/tokens` and pastes it. We hit `GET /v2/user` to validate and `GET /v2/teams` to populate the team selector.
2. **Configure** — user picks Vercel team, project name, GitHub fork URL, and the DAO config (chain, DAO addr, WalletConnect/Alchemy/Pinata keys).
3. **Deploy** — server calls `POST /v11/projects` with `gitRepository` + `environmentVariables` in one shot. Vercel auto-creates a deployment from the linked repo.
4. **Watch** — we poll `GET /v13/deployments/{id}` every 3s, surface the inspector URL while building, and the live `https://*.vercel.app` URL when ready.

All Vercel calls go through [`lib/vercel.ts`](lib/vercel.ts); routes live in [`app/api/`](app/).

---

## Local dev

```bash
pnpm install
pnpm dev
```

Open <http://localhost:3000>. No env vars required for the launchpad itself.

### Testing end-to-end

1. Fork `sktbrd/builder-template-app` into your own GitHub.
2. In Vercel, ensure GitHub is connected (Account → Integrations → GitHub).
3. Generate a token at <https://vercel.com/account/settings/tokens>.
4. Run the form and deploy.

---

## Project layout

```
app/
  layout.tsx
  page.tsx               — multi-step form + deploy progress UI
  globals.css
  api/
    validate/route.ts    — POST: validates token, returns user + teams
    deploy/route.ts      — POST: creates project + initial deployment
    status/route.ts      — POST: polls deployment status
lib/
  config.ts              — env keys, chain options, DeployConfig type
  vercel.ts              — thin Vercel API client (validate, createProject, latestDeployment, getDeployment)
```

---

## Security notes

- **The Vercel token never persists.** It lives in the client component's state and is sent to `/api/*` on each request. No cookies, no DB. Closing the tab forgets it.
- **The server routes use the token as a bearer credential** — they don't store, log, or proxy it elsewhere. Audit `lib/vercel.ts` and the three API routes; that's the entire surface area.
- For a hosted version with multiple users, you'd want to encrypt the token at rest, add CSRF protection on the API routes, and consider migrating to the OAuth flow (below) so users never paste a raw token.

---

## Known limitations (and the v2 upgrade paths)

### 1. User must fork the template manually

Vercel's API can link a project to a Git repo it already has access to — it can't fork on the user's behalf. **Fix:** add a GitHub OAuth flow + `POST /repos/{owner}/{repo}/forks` step before the Vercel step. Then the user only authenticates twice (GitHub, Vercel) instead of forking manually.

### 2. PAT instead of Vercel OAuth

Pasting an API token is fine for self-hosted/dev use; not great for a public hosted launcher. **Fix:** register a Vercel Integration, implement the OAuth code-exchange callback, swap `/api/validate` for `/api/auth/vercel/callback`. The rest of the API routes stay identical — they just get a token from the session instead of the request body.

### 3. No deployment cancellation / rollback UI

The polling shows status but doesn't let the user cancel. **Fix:** add `POST /v12/deployments/{id}/cancel` behind a button.

### 4. Single template hard-coded

Currently expects a Nouns Builder-shaped env. **Fix:** parse `sample.env` from the user-provided repo at validate time and render fields dynamically.

---

## License

MIT