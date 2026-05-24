"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CHAIN_OPTIONS, type EnvKey } from "@/lib/config";

type ScreenId =
  | "welcome"
  | "vercel"
  | "github"
  | "vercel-bridge"
  | "name"
  | "fork"
  | "chain"
  | "token"
  | "walletconnect"
  | "advanced-prompt"
  | "alchemy"
  | "pinata-key"
  | "pinata-gw"
  | "site-url"
  | "review"
  | "building"
  | "done"
  | "error";

type NameStatus = "idle" | "checking" | "ok" | "taken" | "error";

type Me = {
  vercel: { connected: boolean; username?: string; email?: string; teamId?: string | null };
  github: { connected: boolean; login?: string };
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
  const [screen, setScreen] = useState<ScreenId>("welcome");
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [loadingMe, setLoadingMe] = useState(true);

  const [projectName, setProjectName] = useState("my-dao-site");
  const [nameStatus, setNameStatus] = useState<NameStatus>("idle");
  const [bridgeConfirmed, setBridgeConfirmed] = useState(false);
  const [forkedRepo, setForkedRepo] = useState<string>("");
  const [forkedRepoId, setForkedRepoId] = useState<number | undefined>();
  const [forking, setForking] = useState(false);
  const [env, setEnv] = useState<Record<EnvKey, string>>(INITIAL_ENV);
  const [advanced, setAdvanced] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [bridgeHint, setBridgeHint] = useState<string | null>(null);
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [deployedProject, setDeployedProject] = useState<string>("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Build the ordered flow based on current state.
  const flow = useMemo<ScreenId[]>(() => {
    const out: ScreenId[] = ["welcome"];
    if (!me?.vercel.connected) out.push("vercel");
    if (!me?.github.connected) out.push("github");
    if (!bridgeConfirmed) out.push("vercel-bridge");
    out.push("name", "fork", "chain", "token", "walletconnect", "advanced-prompt");
    if (advanced) out.push("alchemy", "pinata-key", "pinata-gw", "site-url");
    out.push("review");
    return out;
  }, [me, advanced, bridgeConfirmed]);

  const idx = flow.indexOf(screen);
  const progress = idx >= 0 ? ((idx + 1) / flow.length) * 100 : 100;

  const next = () => {
    const i = flow.indexOf(screen);
    if (i >= 0 && i < flow.length - 1) setScreen(flow[i + 1]);
  };
  const prev = () => {
    const i = flow.indexOf(screen);
    if (i > 0) setScreen(flow[i - 1]);
  };

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((data: Me) => {
        setMe(data);
        // If already connected, skip past welcome / connect screens to the
        // bridge confirmation step (or name if bridge already confirmed).
        if (data.vercel.connected && data.github.connected) {
          setScreen(bridgeConfirmed ? "name" : "vercel-bridge");
        }
      })
      .finally(() => setLoadingMe(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced project name uniqueness check against Vercel.
  useEffect(() => {
    if (!me?.vercel.connected) return;
    if (validateProjectName(projectName)) {
      setNameStatus("idle");
      return;
    }
    setNameStatus("checking");
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/vercel/check-name?name=${encodeURIComponent(projectName)}`,
        );
        const data = await res.json();
        if (!res.ok) {
          setNameStatus("error");
          return;
        }
        setNameStatus(data.available ? "ok" : "taken");
      } catch {
        setNameStatus("error");
      }
    }, 500);
    return () => clearTimeout(t);
  }, [projectName, me?.vercel.connected]);

  // Keyboard: Enter advances on most screens (only if current input is valid).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
        if (tag === "textarea" || tag === "button") return;
        const blocked: Record<string, boolean> = {
          name: !!validateProjectName(projectName) || nameStatus !== "ok",
          token: !!validateTokenAddress(env.NEXT_PUBLIC_DAO_TOKEN_ADDRESS),
          walletconnect: !env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID,
        };
        const advancable = [
          "name",
          "token",
          "walletconnect",
          "alchemy",
          "pinata-key",
          "pinata-gw",
          "site-url",
        ];
        if (advancable.includes(screen) && !blocked[screen]) {
          e.preventDefault();
          next();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [screen, flow, projectName, env, nameStatus]);

  const refreshMe = async () => {
    const res = await fetch("/api/me");
    const data: Me = await res.json();
    setMe(data);
    return data;
  };

  const disconnect = async (target: "vercel" | "github" | "all") => {
    await fetch("/api/logout", {
      method: "POST",
      body: JSON.stringify({ target }),
    });
    await refreshMe();
    setScreen("welcome");
  };

  const autoFork = async () => {
    setForking(true);
    setError(null);
    try {
      const res = await fetch("/api/github/fork", {
        method: "POST",
        body: JSON.stringify({ name: projectName || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Fork failed");
      setForkedRepo(data.repo.full_name);
      setForkedRepoId(data.repo.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setForking(false);
    }
  };

  const deploy = async () => {
    setDeploying(true);
    setError(null);
    setBridgeHint(null);
    setScreen("building");
    try {
      if (!forkedRepo) throw new Error("Fork the template first.");
      const res = await fetch("/api/deploy", {
        method: "POST",
        body: JSON.stringify({
          config: { projectName, githubRepo: forkedRepo, env },
          repoId: forkedRepoId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = (data.error || "").toLowerCase();
        const looksLikeBridge =
          msg.includes("repo") ||
          msg.includes("github") ||
          msg.includes("permission") ||
          msg.includes("not found") ||
          data.code === "not_found" ||
          data.code === "forbidden";
        if (looksLikeBridge && me?.github.login) {
          setBridgeHint(me.github.login);
        }
        throw new Error(data.error || "Deploy failed");
      }
      setDeployedProject(data.projectName);
      setDeployment(data.deployment ?? null);
      if (!data.deployment) setScreen("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setScreen("error");
    } finally {
      setDeploying(false);
    }
  };

  useEffect(() => {
    if (screen !== "building" || !deployment) return;
    const poll = async () => {
      const res = await fetch("/api/status", {
        method: "POST",
        body: JSON.stringify({ deploymentId: deployment.uid }),
      });
      const data = await res.json();
      if (data.deployment) {
        setDeployment(data.deployment);
        if (data.deployment.readyState === "READY") setScreen("done");
        if (data.deployment.readyState === "ERROR") {
          setError("Build failed. Check the inspector for details.");
          setScreen("error");
        }
      }
    };
    pollRef.current = setInterval(poll, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [screen, deployment]);

  const setEnvField = (k: EnvKey, v: string) =>
    setEnv((s) => ({ ...s, [k]: v }));

  const canLaunch =
    projectName &&
    forkedRepo &&
    env.NEXT_PUBLIC_DAO_TOKEN_ADDRESS &&
    env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID;

  return (
    <div className="relative min-h-screen overflow-hidden bg-black text-white">
      <BackgroundGlow />

      {idx >= 0 && (
        <div className="fixed left-0 right-0 top-0 z-50 h-1 bg-white/5">
          <div
            className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {idx > 0 && (
        <button
          onClick={prev}
          className="fixed left-6 top-6 z-40 rounded-full border border-white/10 bg-black/40 px-3 py-1.5 text-xs text-neutral-400 backdrop-blur hover:text-white"
        >
          ← Back
        </button>
      )}

      <main className="relative flex min-h-screen flex-col items-center justify-center px-6 py-20">
        <ScreenFrame key={screen}>
          {screen === "welcome" && (
            <WelcomeScreen onStart={() => next()} loading={loadingMe} />
          )}
          {screen === "vercel" && (
            <ConnectScreen
              name="Vercel"
              icon={<VercelMark />}
              installHref="/api/vercel/install"
              questionNumber={1}
              question="First, connect Vercel"
              hint="We deploy your site to your own Vercel account."
            />
          )}
          {screen === "github" && (
            <ConnectScreen
              name="GitHub"
              icon={<GitHubMark />}
              installHref="/api/github/install"
              questionNumber={me?.vercel.connected ? 2 : 1}
              question="Now, connect GitHub"
              hint="So we can fork the template into your account."
            />
          )}
          {screen === "vercel-bridge" && (
            <BridgeScreen
              number={qn(flow, "vercel-bridge")}
              onConfirm={() => {
                setBridgeConfirmed(true);
                setTimeout(() => setScreen("name"), 50);
              }}
            />
          )}
          {screen === "name" && (
            <InputScreen
              number={qn(flow, "name")}
              question="Name your DAO site"
              hint="Lowercase letters, digits, '.', '_', '-'. Becomes your-name.vercel.app."
              value={projectName}
              onChange={(v) => setProjectName(v.toLowerCase())}
              placeholder="my-dao-site"
              onNext={next}
              canNext={
                !validateProjectName(projectName) && nameStatus === "ok"
              }
              error={
                validateProjectName(projectName) ??
                (nameStatus === "taken"
                  ? `"${projectName}" already exists on your Vercel account`
                  : null)
              }
              statusBadge={
                !validateProjectName(projectName) ? (
                  <NameStatusBadge status={nameStatus} />
                ) : null
              }
            />
          )}
          {screen === "fork" && (
            <ForkScreen
              number={qn(flow, "fork")}
              ghLogin={me?.github.login}
              projectName={projectName}
              forkedRepo={forkedRepo}
              forking={forking}
              onFork={autoFork}
              onNext={next}
            />
          )}
          {screen === "chain" && (
            <ChainScreen
              number={qn(flow, "chain")}
              value={env.NEXT_PUBLIC_CHAIN_ID}
              onChange={(id) => {
                const opt = CHAIN_OPTIONS.find((c) => c.id === id);
                if (!opt) return;
                setEnvField("NEXT_PUBLIC_CHAIN_ID", opt.id);
                setEnvField("NEXT_PUBLIC_NETWORK_TYPE", opt.network);
              }}
              onNext={next}
            />
          )}
          {screen === "token" && (
            <InputScreen
              number={qn(flow, "token")}
              question="What's your DAO token address?"
              hint="The ERC-721 token contract address for your DAO."
              value={env.NEXT_PUBLIC_DAO_TOKEN_ADDRESS}
              onChange={(v) => setEnvField("NEXT_PUBLIC_DAO_TOKEN_ADDRESS", v)}
              placeholder="0x…"
              onNext={next}
              canNext={!validateTokenAddress(env.NEXT_PUBLIC_DAO_TOKEN_ADDRESS)}
              error={validateTokenAddress(env.NEXT_PUBLIC_DAO_TOKEN_ADDRESS)}
            />
          )}
          {screen === "walletconnect" && (
            <InputScreen
              number={qn(flow, "walletconnect")}
              question="WalletConnect Project ID?"
              hint="Free at cloud.reown.com — paste your project ID here."
              value={env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID}
              onChange={(v) =>
                setEnvField("NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID", v)
              }
              placeholder="0123abcd…"
              onNext={next}
              canNext={Boolean(env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID)}
            />
          )}
          {screen === "advanced-prompt" && (
            <ChoiceScreen
              number={qn(flow, "advanced-prompt")}
              question="Add advanced settings?"
              hint="Alchemy, Pinata, custom site URL. Optional."
              options={[
                {
                  label: "Yes",
                  desc: "I'll add Alchemy / Pinata keys",
                  onSelect: () => {
                    setAdvanced(true);
                    setTimeout(() => setScreen("alchemy"), 50);
                  },
                },
                {
                  label: "No, skip",
                  desc: "Use defaults, deploy now",
                  onSelect: () => {
                    setAdvanced(false);
                    setTimeout(() => setScreen("review"), 50);
                  },
                },
              ]}
            />
          )}
          {screen === "alchemy" && (
            <InputScreen
              number={qn(flow, "alchemy")}
              question="Alchemy API key"
              hint="Optional. Better RPC reliability."
              value={env.NEXT_PUBLIC_ALCHEMY_API_KEY}
              onChange={(v) => setEnvField("NEXT_PUBLIC_ALCHEMY_API_KEY", v)}
              placeholder="alch_…"
              onNext={next}
              canNext
              optional
            />
          )}
          {screen === "pinata-key" && (
            <InputScreen
              number={qn(flow, "pinata-key")}
              question="Pinata JWT"
              hint="Optional. For IPFS uploads."
              value={env.PINATA_API_KEY}
              onChange={(v) => setEnvField("PINATA_API_KEY", v)}
              placeholder="eyJ…"
              onNext={next}
              canNext
              optional
              password
            />
          )}
          {screen === "pinata-gw" && (
            <InputScreen
              number={qn(flow, "pinata-gw")}
              question="Pinata gateway URL"
              hint="Optional. Your dedicated gateway."
              value={env.NEXT_PUBLIC_PINATA_GATEWAY}
              onChange={(v) => setEnvField("NEXT_PUBLIC_PINATA_GATEWAY", v)}
              placeholder="https://gateway.mypinata.cloud"
              onNext={next}
              canNext
              optional
            />
          )}
          {screen === "site-url" && (
            <InputScreen
              number={qn(flow, "site-url")}
              question="Custom site URL"
              hint="Optional. Used for sitemap & robots.txt."
              value={env.NEXT_PUBLIC_SITE_URL}
              onChange={(v) => setEnvField("NEXT_PUBLIC_SITE_URL", v)}
              placeholder="https://yourdao.com"
              onNext={next}
              canNext
              optional
            />
          )}
          {screen === "review" && (
            <ReviewScreen
              projectName={projectName}
              forkedRepo={forkedRepo}
              chainId={env.NEXT_PUBLIC_CHAIN_ID}
              token={env.NEXT_PUBLIC_DAO_TOKEN_ADDRESS}
              vercelUsername={me?.vercel.username}
              ghLogin={me?.github.login}
              canLaunch={Boolean(canLaunch)}
              deploying={deploying}
              onLaunch={deploy}
              onEditVercel={() => disconnect("vercel")}
              onEditGithub={() => disconnect("github")}
            />
          )}
          {screen === "building" && <BuildingScreen deployment={deployment} />}
          {screen === "done" && (
            <DoneScreen
              projectName={deployedProject || projectName}
              deployment={deployment}
              onReset={() => {
                setScreen("welcome");
                setDeployment(null);
                setDeployedProject("");
                setForkedRepo("");
                setForkedRepoId(undefined);
              }}
            />
          )}
          {screen === "error" && (
            <ErrorScreen
              error={error}
              bridgeHint={bridgeHint}
              onRetry={() => {
                setError(null);
                setScreen("review");
              }}
            />
          )}
        </ScreenFrame>
      </main>
    </div>
  );
}

function qn(flow: ScreenId[], id: ScreenId): number {
  return flow.indexOf(id) + 1;
}

function validateProjectName(name: string): string | null {
  if (!name) return "Required";
  if (name.length > 100) return "Max 100 characters";
  if (name !== name.toLowerCase()) return "Must be lowercase";
  if (!/^[a-z0-9._-]+$/.test(name))
    return "Only lowercase letters, digits, '.', '_', '-'";
  if (name.includes("---")) return "Can't contain '---'";
  if (/^[._-]/.test(name)) return "Can't start with '.', '_', or '-'";
  if (/[._-]$/.test(name)) return "Can't end with '.', '_', or '-'";
  return null;
}

function validateTokenAddress(addr: string): string | null {
  if (!addr) return "Required";
  if (!/^0x[a-fA-F0-9]{40}$/.test(addr))
    return "Must be a 0x-prefixed 40-hex-character address";
  return null;
}

function ScreenFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full max-w-xl animate-[fadeIn_400ms_ease-out]">
      {children}
    </div>
  );
}

function WelcomeScreen({
  onStart,
  loading,
}: {
  onStart: () => void;
  loading: boolean;
}) {
  return (
    <div className="text-center">
      <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-neutral-300 backdrop-blur">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
        Builder DAO launcher
      </div>
      <h1 className="bg-gradient-to-b from-white via-white to-neutral-500 bg-clip-text text-5xl font-semibold tracking-tighter text-transparent sm:text-7xl">
        Ship your DAO
        <br />
        in 60 seconds
      </h1>
      <p className="mx-auto mt-6 max-w-md text-base text-neutral-400">
        Answer a few questions, hit launch, and we&apos;ll fork the template,
        configure the env, and deploy it live to your Vercel.
      </p>
      <button onClick={onStart} disabled={loading} className={`${cta} mt-10`}>
        {loading ? "Checking session…" : "Begin"}
      </button>
      <div className="mt-4 text-xs text-neutral-600">
        Press <Kbd>Enter</Kbd> or tap to start
      </div>
    </div>
  );
}

function ConnectScreen({
  name,
  icon,
  installHref,
  questionNumber,
  question,
  hint,
}: {
  name: string;
  icon: React.ReactNode;
  installHref: string;
  questionNumber: number;
  question: string;
  hint: string;
}) {
  return (
    <div>
      <QuestionHeader number={questionNumber} title={question} hint={hint} />
      <a
        href={installHref}
        className="group flex items-center justify-between rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-6 transition-all hover:border-white/20 hover:from-white/[0.08]"
      >
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10">
            {icon}
          </div>
          <div className="text-left">
            <div className="text-lg font-semibold">Connect {name}</div>
            <div className="text-xs text-neutral-500">
              You&apos;ll be redirected to authorize.
            </div>
          </div>
        </div>
        <span className="text-2xl text-neutral-500 transition-transform group-hover:translate-x-1 group-hover:text-white">
          →
        </span>
      </a>
    </div>
  );
}

function InputScreen({
  number,
  question,
  hint,
  value,
  onChange,
  placeholder,
  onNext,
  canNext,
  optional,
  password,
  error,
  statusBadge,
}: {
  number: number;
  question: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  onNext: () => void;
  canNext: boolean;
  optional?: boolean;
  password?: boolean;
  error?: string | null;
  statusBadge?: React.ReactNode;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const showError = touched && error;
  const disabled = optional ? false : !canNext;
  return (
    <div>
      <QuestionHeader number={number} title={question} hint={hint} />
      <div className="relative">
        <input
          ref={ref}
          type={password ? "password" : "text"}
          className={[
            bigInput,
            showError ? "border-red-500/60 focus:border-red-400" : "",
            statusBadge ? "pr-12" : "",
          ].join(" ")}
          value={value}
          onChange={(e) => {
            setTouched(true);
            onChange(e.target.value);
          }}
          placeholder={placeholder}
        />
        {statusBadge && (
          <div className="absolute right-1 top-1/2 -translate-y-1/2">
            {statusBadge}
          </div>
        )}
      </div>
      {showError && (
        <div className="mt-2 text-xs text-red-400">{error}</div>
      )}
      <div className="mt-6 flex items-center gap-4">
        <button onClick={onNext} disabled={disabled} className={ok}>
          OK <span className="opacity-60">↵</span>
        </button>
        {optional && (
          <button
            onClick={onNext}
            className="text-sm text-neutral-500 hover:text-white"
          >
            Skip
          </button>
        )}
        <span className="text-xs text-neutral-600">
          press <Kbd>Enter</Kbd>
        </span>
      </div>
    </div>
  );
}

function NameStatusBadge({ status }: { status: NameStatus }) {
  if (status === "checking")
    return (
      <span className="flex items-center gap-2 rounded-md bg-white/5 px-2 py-1 text-xs text-neutral-400">
        <Spinner /> Checking…
      </span>
    );
  if (status === "ok")
    return (
      <span className="flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-1 text-xs text-emerald-400">
        ✓ Available
      </span>
    );
  if (status === "taken")
    return (
      <span className="flex items-center gap-1 rounded-md bg-red-500/15 px-2 py-1 text-xs text-red-400">
        × Taken
      </span>
    );
  return null;
}

function BridgeScreen({
  number,
  onConfirm,
}: {
  number: number;
  onConfirm: () => void;
}) {
  const [opened, setOpened] = useState(false);
  return (
    <div>
      <QuestionHeader
        number={number}
        title="Let Vercel see your GitHub"
        hint="Vercel needs to read your forked repo to build it. This is a one-time setup."
      />
      <a
        href="https://github.com/apps/vercel/installations/new"
        target="_blank"
        rel="noreferrer"
        onClick={() => setOpened(true)}
        className="group flex items-center justify-between rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-6 transition-all hover:border-white/20 hover:from-white/[0.08]"
      >
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10">
            <VercelMark />
          </div>
          <div className="text-left">
            <div className="text-lg font-semibold">Install Vercel on GitHub</div>
            <div className="text-xs text-neutral-500">
              Opens in a new tab. Pick the account or org with your fork.
            </div>
          </div>
        </div>
        <span className="text-2xl text-neutral-500 transition-transform group-hover:translate-x-1 group-hover:text-white">
          ↗
        </span>
      </a>
      <div className="mt-6 flex items-center gap-4">
        <button onClick={onConfirm} className={ok}>
          I&apos;ve installed it →
        </button>
        <button
          onClick={onConfirm}
          className="text-sm text-neutral-500 hover:text-white"
        >
          Already done, skip
        </button>
      </div>
      {opened && (
        <div className="mt-4 text-xs text-neutral-500">
          Once you&apos;ve installed it on GitHub, come back here and click
          &ldquo;I&apos;ve installed it&rdquo;.
        </div>
      )}
    </div>
  );
}

function ChoiceScreen({
  number,
  question,
  hint,
  options,
}: {
  number: number;
  question: string;
  hint?: string;
  options: { label: string; desc: string; onSelect: () => void }[];
}) {
  return (
    <div>
      <QuestionHeader number={number} title={question} hint={hint} />
      <div className="space-y-3">
        {options.map((opt) => (
          <button
            key={opt.label}
            onClick={opt.onSelect}
            className="group flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-left transition-all hover:border-white/20 hover:bg-white/[0.06]"
          >
            <div>
              <div className="text-base font-semibold">{opt.label}</div>
              <div className="text-xs text-neutral-500">{opt.desc}</div>
            </div>
            <span className="text-xl text-neutral-500 transition-transform group-hover:translate-x-1 group-hover:text-white">
              →
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ChainScreen({
  number,
  value,
  onChange,
  onNext,
}: {
  number: number;
  value: string;
  onChange: (id: string) => void;
  onNext: () => void;
}) {
  return (
    <div>
      <QuestionHeader number={number} title="Which chain?" />
      <div className="space-y-3">
        {CHAIN_OPTIONS.map((c) => {
          const selected = value === c.id;
          return (
            <button
              key={c.id}
              onClick={() => {
                onChange(c.id);
                setTimeout(onNext, 200);
              }}
              className={[
                "group flex w-full items-center justify-between rounded-2xl border p-5 text-left transition-all",
                selected
                  ? "border-emerald-500/40 bg-emerald-500/5"
                  : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]",
              ].join(" ")}
            >
              <div>
                <div className="text-base font-semibold">{c.label}</div>
                <div className="text-xs text-neutral-500">{c.network}</div>
              </div>
              {selected && <span className="text-emerald-400">✓</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ForkScreen({
  number,
  ghLogin,
  projectName,
  forkedRepo,
  forking,
  onFork,
  onNext,
}: {
  number: number;
  ghLogin?: string;
  projectName: string;
  forkedRepo: string;
  forking: boolean;
  onFork: () => void;
  onNext: () => void;
}) {
  return (
    <div>
      <QuestionHeader
        number={number}
        title="Fork the template"
        hint={`We'll fork sktbrd/builder-template-app into @${ghLogin ?? "github"}.`}
      />
      {forkedRepo ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-2xl border border-emerald-500/30 bg-emerald-500/5 px-5 py-4 text-sm">
            <span className="flex items-center gap-3">
              <span className="text-emerald-400">✓</span>
              <code className="text-neutral-200">{forkedRepo}</code>
            </span>
            <a
              href={`https://github.com/${forkedRepo}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-emerald-400 hover:underline"
            >
              Open ↗
            </a>
          </div>
          <button onClick={onNext} className={ok}>
            Continue <span className="opacity-60">↵</span>
          </button>
        </div>
      ) : (
        <button
          onClick={onFork}
          disabled={forking || !projectName}
          className={primary}
        >
          {forking ? (
            <span className="flex items-center gap-2">
              <Spinner /> Forking…
            </span>
          ) : (
            "Fork template now"
          )}
        </button>
      )}
    </div>
  );
}

function ReviewScreen({
  projectName,
  forkedRepo,
  chainId,
  token,
  vercelUsername,
  ghLogin,
  canLaunch,
  deploying,
  onLaunch,
  onEditVercel,
  onEditGithub,
}: {
  projectName: string;
  forkedRepo: string;
  chainId: string;
  token: string;
  vercelUsername?: string;
  ghLogin?: string;
  canLaunch: boolean;
  deploying: boolean;
  onLaunch: () => void;
  onEditVercel: () => void;
  onEditGithub: () => void;
}) {
  const chain = CHAIN_OPTIONS.find((c) => c.id === chainId);
  return (
    <div>
      <QuestionHeader number={undefined} title="Ready to launch" hint="Review and confirm." />
      <dl className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm">
        <Row label="Project">{projectName}</Row>
        <Row label="Repo">
          <code className="text-neutral-300">{forkedRepo}</code>
        </Row>
        <Row label="Chain">{chain?.label ?? chainId}</Row>
        <Row label="Token">
          <code className="text-neutral-300">{shortAddr(token)}</code>
        </Row>
        <Row label="Vercel">
          <span className="flex items-center gap-2">
            @{vercelUsername}
            <button
              onClick={onEditVercel}
              className="text-xs text-neutral-500 hover:text-white"
            >
              change
            </button>
          </span>
        </Row>
        <Row label="GitHub">
          <span className="flex items-center gap-2">
            @{ghLogin}
            <button
              onClick={onEditGithub}
              className="text-xs text-neutral-500 hover:text-white"
            >
              change
            </button>
          </span>
        </Row>
      </dl>
      <button
        onClick={onLaunch}
        disabled={!canLaunch || deploying}
        className={`${cta} mt-6`}
      >
        {deploying ? (
          <span className="flex items-center gap-2">
            <Spinner /> Launching…
          </span>
        ) : (
          "Launch site →"
        )}
      </button>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/5 py-1.5 last:border-0">
      <dt className="text-xs uppercase tracking-wider text-neutral-500">
        {label}
      </dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function BuildingScreen({ deployment }: { deployment: Deployment | null }) {
  const state = deployment?.readyState ?? "QUEUED";
  const labels: Record<string, string> = {
    QUEUED: "Queued",
    INITIALIZING: "Initializing",
    BUILDING: "Building",
    READY: "Ready",
    ERROR: "Failed",
    CANCELED: "Canceled",
  };
  return (
    <div className="text-center">
      <div className="mx-auto mb-8 flex h-20 w-20 items-center justify-center">
        <div className="relative h-16 w-16">
          <div className="absolute inset-0 rounded-full border-4 border-white/10" />
          <div className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-emerald-400" />
        </div>
      </div>
      <h2 className="bg-gradient-to-b from-white to-neutral-500 bg-clip-text text-3xl font-semibold tracking-tight text-transparent">
        {labels[state] ?? state}…
      </h2>
      <p className="mt-3 text-sm text-neutral-400">
        Your DAO site is being built. This usually takes about 60 seconds.
      </p>
      {deployment && (
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3 text-xs">
          {deployment.inspectorUrl && (
            <a
              href={deployment.inspectorUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-neutral-300 hover:bg-white/10"
            >
              Build logs ↗
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function DoneScreen({
  projectName,
  deployment,
  onReset,
}: {
  projectName: string;
  deployment: Deployment | null;
  onReset: () => void;
}) {
  const liveUrl = deployment?.url ? `https://${deployment.url}` : null;
  return (
    <div className="text-center">
      <div className="relative mx-auto mb-8 h-20 w-20">
        <div className="absolute inset-0 rounded-full bg-emerald-500/30 blur-2xl" />
        <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-3xl text-black">
          ✓
        </div>
      </div>
      <h2 className="bg-gradient-to-b from-white to-neutral-500 bg-clip-text text-5xl font-semibold tracking-tight text-transparent">
        You&apos;re live
      </h2>
      <p className="mt-3 text-sm text-neutral-400">
        <code className="text-neutral-200">{projectName}</code> is deployed.
      </p>
      {liveUrl ? (
        <a
          href={liveUrl}
          target="_blank"
          rel="noreferrer"
          className={`${cta} mt-8 inline-flex`}
        >
          Open {deployment?.url} →
        </a>
      ) : (
        <div className="mt-8 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-neutral-400">
          Build still warming up. Open your project dashboard to watch it
          finish.
        </div>
      )}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3 text-xs">
        <a
          href="https://vercel.com/dashboard/projects"
          target="_blank"
          rel="noreferrer"
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-neutral-300 hover:bg-white/10"
        >
          Open in Vercel ↗
        </a>
        {deployment?.inspectorUrl && (
          <a
            href={deployment.inspectorUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-neutral-300 hover:bg-white/10"
          >
            Build logs ↗
          </a>
        )}
        <button
          onClick={onReset}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-neutral-300 hover:bg-white/10"
        >
          Deploy another
        </button>
      </div>
    </div>
  );
}

function ErrorScreen({
  error,
  bridgeHint,
  onRetry,
}: {
  error: string | null;
  bridgeHint: string | null;
  onRetry: () => void;
}) {
  return (
    <div className="text-center">
      <div className="mb-6 inline-flex h-14 w-14 items-center justify-center rounded-full bg-red-500/15 text-2xl text-red-400">
        ×
      </div>
      <h2 className="text-3xl font-semibold tracking-tight">Something broke</h2>
      <p className="mx-auto mt-3 max-w-md text-sm text-red-200">
        {error ?? "Unknown error"}
      </p>
      {bridgeHint && (
        <a
          href="https://github.com/apps/vercel/installations/new"
          target="_blank"
          rel="noreferrer"
          className={`${cta} mt-6 inline-flex`}
        >
          Install Vercel on GitHub →
        </a>
      )}
      <div className="mt-4">
        <button onClick={onRetry} className="text-sm text-neutral-400 hover:text-white">
          ← Try again
        </button>
      </div>
    </div>
  );
}

function QuestionHeader({
  number,
  title,
  hint,
}: {
  number?: number;
  title: string;
  hint?: string;
}) {
  return (
    <div className="mb-6">
      {number !== undefined && (
        <div className="mb-3 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-400">
          {number} →
        </div>
      )}
      <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        {title}
      </h2>
      {hint && <p className="mt-3 text-sm text-neutral-400">{hint}</p>}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-neutral-300">
      {children}
    </kbd>
  );
}

function Spinner() {
  return (
    <span className="inline-block h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
  );
}

function VercelMark() {
  return (
    <svg viewBox="0 0 76 65" className="h-5 w-5 fill-white">
      <path d="M37.527.182l37.527 64.99H0L37.527.182z" />
    </svg>
  );
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" className="h-5 w-5 fill-white">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function BackgroundGlow() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -top-40 left-1/2 h-[600px] w-[900px] -translate-x-1/2 rounded-full bg-emerald-500/15 blur-[140px]" />
      <div className="absolute bottom-0 right-0 h-[500px] w-[500px] rounded-full bg-blue-500/10 blur-[140px]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,black_80%)]" />
    </div>
  );
}

function shortAddr(a: string): string {
  if (!a) return "";
  if (a.length <= 12) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

const cta =
  "inline-flex w-full items-center justify-center rounded-xl bg-gradient-to-b from-white to-neutral-200 py-3.5 text-base font-semibold text-black shadow-lg shadow-white/10 transition-all hover:from-neutral-100 hover:to-neutral-300 disabled:cursor-not-allowed disabled:opacity-30 disabled:shadow-none";

const primary =
  "inline-flex w-full items-center justify-center rounded-xl bg-gradient-to-b from-white to-neutral-200 py-3 text-sm font-semibold text-black shadow-lg shadow-white/10 transition-all hover:from-neutral-100 hover:to-neutral-300 disabled:cursor-not-allowed disabled:opacity-30 disabled:shadow-none";

const ok =
  "inline-flex items-center gap-2 rounded-lg bg-gradient-to-b from-emerald-400 to-emerald-500 px-5 py-2.5 text-sm font-semibold text-black shadow-lg shadow-emerald-500/20 transition-all hover:from-emerald-300 hover:to-emerald-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none";

const bigInput =
  "w-full border-b-2 border-white/20 bg-transparent px-1 py-3 text-2xl font-medium text-white outline-none transition-colors placeholder:text-neutral-700 focus:border-emerald-400";
