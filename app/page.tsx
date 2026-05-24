"use client";

import { useEffect, useRef, useState } from "react";
import { CHAIN_OPTIONS, ENV_KEYS, type EnvKey } from "@/lib/config";

type Step = "token" | "config" | "deploying" | "done" | "error";

type AuthInfo = {
  user: { username: string; email: string };
  teams: { id: string; slug: string; name: string }[];
};

type Deployment = {
  uid: string;
  url: string;
  readyState: string;
  inspectorUrl?: string;
};

const INITIAL_ENV: Record<EnvKey, string> = {
  NEXT_PUBLIC_NETWORK_TYPE: "mainnet",
  NEXT_PUBLIC_CHAIN_ID: "8453",
  NEXT_PUBLIC_DAO_TOKEN_ADDRESS: "",
  NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID: "",
  NEXT_PUBLIC_ALCHEMY_API_KEY: "",
  PINATA_API_KEY: "",
  NEXT_PUBLIC_PINATA_GATEWAY: "",
  NEXT_PUBLIC_SITE_URL: "",
};

export default function Home() {
  const [step, setStep] = useState<Step>("token");
  const [error, setError] = useState<string | null>(null);

  // Step 1: token
  const [token, setToken] = useState("");
  const [auth, setAuth] = useState<AuthInfo | null>(null);
  const [validating, setValidating] = useState(false);

  // Step 2: config
  const [projectName, setProjectName] = useState("my-dao-site");
  const [githubRepo, setGithubRepo] = useState("");
  const [teamId, setTeamId] = useState<string>("");
  const [env, setEnv] = useState<Record<EnvKey, string>>(INITIAL_ENV);
  const [deploying, setDeploying] = useState(false);

  // Step 3+: deployment progress
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [projectName_, setDeployedProject] = useState<string>("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const validate = async () => {
    setValidating(true);
    setError(null);
    try {
      const res = await fetch("/api/validate", {
        method: "POST",
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Token validation failed");
      setAuth(data);
      setStep("config");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setValidating(false);
    }
  };

  const deploy = async () => {
    setDeploying(true);
    setError(null);
    try {
      const res = await fetch("/api/deploy", {
        method: "POST",
        body: JSON.stringify({
          token,
          config: {
            projectName,
            githubRepo,
            teamId: teamId || undefined,
            env,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Deploy failed");
      setDeployedProject(data.projectName);
      if (data.deployment) {
        setDeployment(data.deployment);
        setStep("deploying");
      } else {
        setStep("done");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setStep("error");
    } finally {
      setDeploying(false);
    }
  };

  useEffect(() => {
    if (step !== "deploying" || !deployment) return;
    const poll = async () => {
      const res = await fetch("/api/status", {
        method: "POST",
        body: JSON.stringify({
          token,
          deploymentId: deployment.uid,
          teamId: teamId || undefined,
        }),
      });
      const data = await res.json();
      if (data.deployment) {
        setDeployment(data.deployment);
        if (data.deployment.readyState === "READY") setStep("done");
        if (data.deployment.readyState === "ERROR") {
          setError("Deployment failed — check the inspector for build logs.");
          setStep("error");
        }
      }
    };
    pollRef.current = setInterval(poll, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [step, deployment, token, teamId]);

  const setEnvField = (k: EnvKey, v: string) =>
    setEnv((s) => ({ ...s, [k]: v }));

  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">
          Builder Deploy Direct
        </h1>
        <p className="mt-2 text-sm text-neutral-400">
          Configure + deploy a builder-template-app fork straight to your
          Vercel account via the API. No copy-paste.
        </p>
        <Stepper step={step} />
      </header>

      {error && (
        <div className="mb-6 rounded-md border border-red-900 bg-red-950/40 p-4 text-sm text-red-200">
          {error}
        </div>
      )}

      {step === "token" && (
        <Section title="Step 1 — Connect Vercel">
          <p className="text-sm text-neutral-400">
            Generate a Personal Access Token at{" "}
            <a
              className="text-blue-400 underline"
              href="https://vercel.com/account/settings/tokens"
              target="_blank"
              rel="noreferrer"
            >
              vercel.com/account/settings/tokens
            </a>
            . Scope: full account. The token stays in your browser session and
            is sent only to this app&apos;s server.
          </p>
          <input
            className={inputClass}
            type="password"
            placeholder="Vercel API token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <button
            onClick={validate}
            disabled={!token || validating}
            className={primaryBtn}
          >
            {validating ? "Validating…" : "Continue"}
          </button>
        </Section>
      )}

      {step === "config" && auth && (
        <div className="space-y-6">
          <Section title="Connected">
            <p className="text-sm text-neutral-400">
              Signed in as <strong>{auth.user.username}</strong> (
              {auth.user.email}).
            </p>
            {auth.teams.length > 0 && (
              <Field label="Deploy to">
                <select
                  className={inputClass}
                  value={teamId}
                  onChange={(e) => setTeamId(e.target.value)}
                >
                  <option value="">Personal account</option>
                  {auth.teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.slug})
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </Section>

          <Section title="Step 2 — Project">
            <Field
              label="Vercel project name"
              hint="Lowercase, dashes only. Becomes your-name.vercel.app."
            >
              <input
                className={inputClass}
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
              />
            </Field>
            <Field
              label="GitHub repo (your fork of the template)"
              hint="Fork github.com/sktbrd/builder-template-app first, then paste your fork URL or owner/repo here."
            >
              <input
                className={inputClass}
                placeholder="your-username/builder-template-app"
                value={githubRepo}
                onChange={(e) => setGithubRepo(e.target.value)}
              />
            </Field>
          </Section>

          <Section title="Step 3 — DAO config">
            <Field label="Chain">
              <select
                className={inputClass}
                value={env.NEXT_PUBLIC_CHAIN_ID}
                onChange={(e) => {
                  const opt = CHAIN_OPTIONS.find(
                    (c) => c.id === e.target.value,
                  );
                  if (!opt) return;
                  setEnvField("NEXT_PUBLIC_CHAIN_ID", opt.id);
                  setEnvField("NEXT_PUBLIC_NETWORK_TYPE", opt.network);
                }}
              >
                {CHAIN_OPTIONS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="DAO token address">
              <input
                className={inputClass}
                placeholder="0x..."
                value={env.NEXT_PUBLIC_DAO_TOKEN_ADDRESS}
                onChange={(e) =>
                  setEnvField("NEXT_PUBLIC_DAO_TOKEN_ADDRESS", e.target.value)
                }
              />
            </Field>
            <Field
              label="WalletConnect Project ID"
              hint="Free at cloud.reown.com"
            >
              <input
                className={inputClass}
                value={env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID}
                onChange={(e) =>
                  setEnvField(
                    "NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID",
                    e.target.value,
                  )
                }
              />
            </Field>
            <Field label="Alchemy API key" hint="Recommended">
              <input
                className={inputClass}
                value={env.NEXT_PUBLIC_ALCHEMY_API_KEY}
                onChange={(e) =>
                  setEnvField("NEXT_PUBLIC_ALCHEMY_API_KEY", e.target.value)
                }
              />
            </Field>
            <Field label="Pinata API key (JWT)" hint="Recommended">
              <input
                className={inputClass}
                type="password"
                value={env.PINATA_API_KEY}
                onChange={(e) => setEnvField("PINATA_API_KEY", e.target.value)}
              />
            </Field>
            <Field label="Pinata gateway" hint="Optional">
              <input
                className={inputClass}
                placeholder="https://gateway.mypinata.cloud"
                value={env.NEXT_PUBLIC_PINATA_GATEWAY}
                onChange={(e) =>
                  setEnvField("NEXT_PUBLIC_PINATA_GATEWAY", e.target.value)
                }
              />
            </Field>
            <Field label="Site URL" hint="Optional — used for sitemap/robots">
              <input
                className={inputClass}
                placeholder="https://yoursite.com"
                value={env.NEXT_PUBLIC_SITE_URL}
                onChange={(e) =>
                  setEnvField("NEXT_PUBLIC_SITE_URL", e.target.value)
                }
              />
            </Field>
          </Section>

          <button
            onClick={deploy}
            disabled={
              deploying ||
              !projectName ||
              !githubRepo ||
              !env.NEXT_PUBLIC_DAO_TOKEN_ADDRESS ||
              !env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID
            }
            className={primaryBtn}
          >
            {deploying ? "Creating project…" : "Deploy to Vercel"}
          </button>
        </div>
      )}

      {step === "deploying" && deployment && (
        <Section title="Deploying">
          <p className="text-sm text-neutral-400">
            Status: <strong>{deployment.readyState}</strong>
          </p>
          <div className="flex gap-3">
            <a
              href={deployment.inspectorUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-blue-400 underline"
            >
              Open build logs
            </a>
            {deployment.url && (
              <a
                href={`https://${deployment.url}`}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-blue-400 underline"
              >
                Preview URL
              </a>
            )}
          </div>
        </Section>
      )}

      {step === "done" && (
        <Section title="Deployed">
          <p className="text-sm text-neutral-400">
            <strong>{projectName_}</strong> is live.
          </p>
          {deployment?.url && (
            <a
              href={`https://${deployment.url}`}
              target="_blank"
              rel="noreferrer"
              className={primaryBtn}
            >
              Open {deployment.url} →
            </a>
          )}
        </Section>
      )}

      {step === "error" && (
        <button
          onClick={() => {
            setError(null);
            setStep(auth ? "config" : "token");
          }}
          className="text-sm text-neutral-400 hover:text-white"
        >
          ← Try again
        </button>
      )}
    </main>
  );
}

const inputClass =
  "w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-500";

const primaryBtn =
  "inline-flex w-full items-center justify-center rounded-md bg-white py-3 font-medium text-black transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-lg border border-neutral-900 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-400">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-neutral-500">{hint}</span>}
    </label>
  );
}

function Stepper({ step }: { step: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: "token", label: "Connect" },
    { key: "config", label: "Configure" },
    { key: "deploying", label: "Deploy" },
    { key: "done", label: "Live" },
  ];
  const currentIdx = steps.findIndex((s) => s.key === step);
  return (
    <ol className="mt-6 flex gap-2 text-xs">
      {steps.map((s, i) => (
        <li
          key={s.key}
          className={`rounded-full px-3 py-1 ${
            i <= currentIdx
              ? "bg-white text-black"
              : "bg-neutral-900 text-neutral-500"
          }`}
        >
          {i + 1}. {s.label}
        </li>
      ))}
    </ol>
  );
}
