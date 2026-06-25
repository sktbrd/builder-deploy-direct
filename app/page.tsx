"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { CHAIN_OPTIONS, type EnvKey } from "@/lib/config";

const PixelBlast = dynamic(() => import("@/components/PixelBlast"), {
  ssr: false,
});

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

// Dev-only screen preview (?screen=review): seeds the state a screen needs
// so it can be styled without going through OAuth. No flows are simulated.
const previewTarget =
  process.env.NODE_ENV === "development" && typeof window !== "undefined"
    ? (new URLSearchParams(window.location.search).get("screen") as ScreenId | null)
    : null;

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
  const [deployedProjectId, setDeployedProjectId] = useState<string>("");
  const [slowBuild, setSlowBuild] = useState(false);
  const [deployStage, setDeployStage] = useState<
    "create" | "trigger" | "build" | null
  >(null);
  const [deployBridge, setDeployBridge] = useState(false);
  const [bridgeChecking, setBridgeChecking] = useState(false);
  const [bridgeWarning, setBridgeWarning] = useState<string | null>(null);
  const [bridgeNamespaces, setBridgeNamespaces] = useState<string[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Mirror the latest deployment into a ref so the polling interval can read
  // the current deployment id without re-subscribing every tick.
  const deploymentRef = useRef<Deployment | null>(null);
  useEffect(() => {
    deploymentRef.current = deployment;
  }, [deployment]);

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
    if (previewTarget) return;
    fetch("/api/me")
      .then((r) => r.json())
      .then((data: Me) => setMe(data))
      .finally(() => setLoadingMe(false));
  }, []);

  // Seed state for the dev screen preview (see previewTarget above).
  useEffect(() => {
    if (!previewTarget) return;
    setLoadingMe(false);
    const authScreens: ScreenId[] = ["welcome", "vercel", "github"];
    if (!authScreens.includes(previewTarget)) {
      setMe({
        vercel: { connected: true, username: "preview", teamId: null },
        github: { connected: true, login: "preview" },
      });
      if (previewTarget !== "vercel-bridge") setBridgeConfirmed(true);
      setForkedRepo("preview/builder-template-app");
      setForkedRepoId(1);
      setNameStatus("ok");
      setEnv((s) => ({
        ...s,
        NEXT_PUBLIC_DAO_TOKEN_ADDRESS: `0x${"ab".repeat(20)}`,
        NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID: "preview-project-id",
      }));
    }
    if (previewTarget === "building" || previewTarget === "done") {
      setDeployment({
        uid: "preview",
        url: "my-dao-site.vercel.app",
        readyState: previewTarget === "done" ? "READY" : "BUILDING",
        inspectorUrl: "https://vercel.com",
      });
      setDeployedProject("my-dao-site");
    }
    if (previewTarget === "error") {
      setError("Preview error message — styling the error screen.");
    }
    setScreen(previewTarget);
  }, []);

  // Debounced project name uniqueness check against Vercel.
  useEffect(() => {
    if (!me?.vercel.connected) return;
    if (validateProjectName(projectName)) {
      setNameStatus("idle");
      return;
    }
    if (previewTarget) {
      setNameStatus("ok");
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
          welcome: loadingMe,
          fork: !forkedRepo,
          name: !!validateProjectName(projectName) || nameStatus !== "ok",
          token: !!validateTokenAddress(env.NEXT_PUBLIC_DAO_TOKEN_ADDRESS),
          walletconnect: !env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID,
        };
        const advancable = [
          "welcome",
          "fork",
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
  }, [screen, flow, projectName, env, nameStatus, loadingMe, forkedRepo]);

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

  const proceedFromBridge = () => {
    setBridgeWarning(null);
    setBridgeConfirmed(true);
    setTimeout(() => setScreen("name"), 50);
  };

  // Verify Vercel actually has access to the user's GitHub before advancing.
  // On a clear "not connected" answer we block with a targeted reason; on a
  // network/permission hiccup we don't hard-block (warn + allow force on).
  const confirmBridge = async () => {
    setBridgeChecking(true);
    setBridgeWarning(null);
    setBridgeNamespaces([]);
    try {
      const res = await fetch("/api/vercel/check-github");
      const data = await res.json();
      if (res.ok && data.hasBridge) {
        setBridgeChecking(false);
        proceedFromBridge();
        return;
      }
      if (res.ok) {
        const login = data.ghLogin ?? "your GitHub";
        setBridgeNamespaces(data.githubNamespaces ?? []);
        setBridgeWarning(
          data.reason === "no-github"
            ? `Vercel isn't connected to any GitHub account yet. Install the Vercel GitHub app on @${login} (the account that has your fork), then check again.`
            : `Vercel is connected to GitHub, but not to @${login}. Install/configure the Vercel GitHub app on the account or org that holds your fork, then check again.`,
        );
        setBridgeChecking(false);
        return;
      }
    } catch {
      // Verification itself failed — don't block on it.
    }
    setBridgeChecking(false);
    proceedFromBridge();
  };

  const deploy = async () => {
    setDeploying(true);
    setError(null);
    setBridgeHint(null);
    setDeployStage(null);
    setDeployBridge(false);
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
        // The project may already exist (stage "trigger") — keep its link so
        // the error screen can still point the user at it.
        if (data.projectId) setDeployedProjectId(data.projectId);
        if (data.projectName) setDeployedProject(data.projectName);
        setDeployStage(data.stage ?? null);
        const msg = (data.error || "").toLowerCase();
        const looksLikeBridge =
          msg.includes("repo") ||
          msg.includes("github") ||
          msg.includes("permission") ||
          msg.includes("not found") ||
          data.code === "not_found" ||
          data.code === "forbidden";
        setDeployBridge(looksLikeBridge);
        if (looksLikeBridge && me?.github.login) setBridgeHint(me.github.login);
        throw new Error(data.error || "Deploy failed");
      }
      setDeployedProject(data.projectName);
      setDeployedProjectId(data.projectId);
      setDeployment(data.deployment ?? null);
      // Stay on "building". The poller below takes over and will discover the
      // deployment by projectId even if the webhook build hasn't appeared yet,
      // then advance to "done" only once it's actually READY (with a URL).
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setScreen("error");
    } finally {
      setDeploying(false);
    }
  };

  // A single status check, reusable by both the interval poller and the manual
  // "Refresh status" button. Polls by deployment id once known, else by project.
  const pollOnce = useCallback(async () => {
    if (!deployedProjectId) return;
    try {
      const id = deploymentRef.current?.uid;
      const res = await fetch("/api/status", {
        method: "POST",
        body: JSON.stringify(
          id ? { deploymentId: id } : { projectId: deployedProjectId },
        ),
      });
      const data = await res.json();
      if (data.deployment) {
        setDeployment(data.deployment);
        const state = data.deployment.readyState;
        if (state === "READY") setScreen("done");
        if (state === "ERROR" || state === "CANCELED") {
          setDeployStage("build");
          setError(
            state === "CANCELED"
              ? "The build was canceled."
              : "Build failed. Check the inspector for details.",
          );
          setScreen("error");
        }
      }
    } catch {
      // transient network error — keep polling
    }
  }, [deployedProjectId]);

  useEffect(() => {
    if (previewTarget || screen !== "building" || !deployedProjectId) return;
    let attempts = 0;
    setSlowBuild(false);
    const tick = async () => {
      attempts++;
      // ~30s with no resolution → surface a "taking longer" hint, but keep
      // polling. Webhook-triggered first builds can be slow to appear.
      if (attempts >= 10) setSlowBuild(true);
      await pollOnce();
    };
    tick();
    pollRef.current = setInterval(tick, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [screen, deployedProjectId, pollOnce]);

  const setEnvField = (k: EnvKey, v: string) =>
    setEnv((s) => ({ ...s, [k]: v }));

  const canLaunch =
    projectName &&
    forkedRepo &&
    env.NEXT_PUBLIC_DAO_TOKEN_ADDRESS &&
    env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID;

  return (
    <div className="relative min-h-screen overflow-hidden text-neutral-900 dark:text-white">
      <BackgroundGlow />

      {idx >= 0 && (
        <div
          role="progressbar"
          aria-label="Setup progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
          className="fixed left-0 right-0 top-0 z-50 h-1 bg-black/5 dark:bg-white/5"
        >
          <div
            className="h-full bg-gradient-to-r from-blue-400 to-blue-500 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {idx > 0 && (
        <button
          onClick={prev}
          className="fixed left-6 top-6 z-40 rounded-full border border-black/10 dark:border-white/10 bg-white/70 dark:bg-black/40 px-3 py-1.5 text-sm text-neutral-800 dark:text-neutral-200 backdrop-blur hover:text-(--foreground)"
        >
          ← Back
        </button>
      )}

      <ThemeToggle />

      <main className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6 py-20">
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
              ghLogin={me?.github.login}
              checking={bridgeChecking}
              warning={bridgeWarning}
              namespaces={bridgeNamespaces}
              onConfirm={confirmBridge}
              onForce={proceedFromBridge}
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
          {screen === "building" && (
            <BuildingScreen
              deployment={deployment}
              slow={slowBuild}
              projectName={deployedProject || projectName}
              onRefresh={pollOnce}
              onRecheckBridge={() => setScreen("vercel-bridge")}
            />
          )}
          {screen === "done" && (
            <DoneScreen
              projectName={deployedProject || projectName}
              deployment={deployment}
              onReset={() => {
                setScreen("welcome");
                setDeployment(null);
                setDeployedProject("");
                setDeployedProjectId("");
                setSlowBuild(false);
                setForkedRepo("");
                setForkedRepoId(undefined);
              }}
            />
          )}
          {screen === "error" && (
            <ErrorScreen
              error={error}
              stage={deployStage}
              bridgeHint={bridgeHint}
              bridge={deployBridge}
              projectName={deployedProject || null}
              projectId={deployedProjectId || null}
              repo={forkedRepo || null}
              onRecheckBridge={() => {
                setError(null);
                setScreen("vercel-bridge");
              }}
              debugUrl={
                process.env.NODE_ENV === "development" &&
                projectName &&
                forkedRepo
                  ? `/api/debug?project=${encodeURIComponent(projectName)}`
                  : null
              }
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
      <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-blue-600/40 bg-blue-500/15 px-3 py-1 text-sm font-medium text-blue-800 backdrop-blur dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-200">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-600 dark:bg-blue-400" />
        Builder DAO launcher
      </div>
      <h1 className="text-5xl font-semibold tracking-tighter text-neutral-900 dark:text-white sm:text-7xl dark:[text-shadow:0_2px_24px_rgba(0,0,0,0.35)]">
        Your DAO site,
        <br />
        <span className="bg-gradient-to-r from-blue-700 to-blue-500 bg-clip-text text-transparent dark:from-white dark:via-blue-100 dark:to-white">
          live in 60 seconds
        </span>
      </h1>
      <p className="mx-auto mt-6 max-w-lg text-lg text-neutral-700 dark:text-neutral-200 dark:[text-shadow:0_1px_8px_rgba(0,0,0,0.25)]">
        A no-code launcher for{" "}
        <a
          href="https://nouns.build"
          target="_blank"
          rel="noreferrer"
          className="text-blue-700 underline-offset-2 hover:underline dark:text-blue-200"
          suppressHydrationWarning
        >
          Builder DAO
        </a>{" "}
        front-ends. Connect your accounts, point us at your DAO, and we ship
        a fully-configured site to your Vercel — no code, no copy-paste.
      </p>

      <div className="mx-auto mt-10 grid max-w-xl gap-3 text-left sm:grid-cols-3">
        <Step n="1" title="Authorize" desc="Vercel and GitHub, two clicks each." />
        <Step n="2" title="Configure" desc="DAO token, chain, optional keys." />
        <Step n="3" title="Launch" desc="We fork, configure env, deploy." />
      </div>

      <button onClick={onStart} disabled={loading} className={`${cta} mt-10`}>
        {loading ? "Checking session…" : "Get started"}
      </button>
      <div className="mt-4 text-sm text-neutral-700 dark:text-neutral-400">
        Press <Kbd>Enter</Kbd> to continue
      </div>
      <p className="mx-auto mt-8 max-w-md text-sm text-neutral-700 dark:text-neutral-400">
        Your tokens stay in your browser session and are sent only between
        you, Vercel, and GitHub. We don&apos;t store anything server-side.
      </p>
    </div>
  );
}

function Step({
  n,
  title,
  desc,
}: {
  n: string;
  title: string;
  desc: string;
}) {
  return (
    <div className="rounded-xl border border-black/10 dark:border-white/10 bg-white/70 dark:bg-black/40 p-4 backdrop-blur-md">
      <div className="mb-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-500/20 text-sm font-semibold text-blue-700 dark:text-blue-200">
        {n}
      </div>
      <div className="text-base font-semibold text-neutral-900 dark:text-white">{title}</div>
      <div className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">{desc}</div>
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
        className="group flex items-center justify-between rounded-2xl border border-black/10 dark:border-white/10 bg-white/60 dark:bg-black/30 p-6 backdrop-blur-md transition-all hover:border-black/20 dark:hover:border-white/20 hover:bg-white/70 dark:hover:bg-black/40"
      >
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-black/10 dark:bg-white/10">
            {icon}
          </div>
          <div className="text-left">
            <div className="text-xl font-semibold">Connect {name}</div>
            <div className="text-sm text-neutral-500">
              You&apos;ll be redirected to authorize.
            </div>
          </div>
        </div>
        <span className="text-3xl text-neutral-500 transition-transform group-hover:translate-x-1 group-hover:text-(--foreground)">
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
        <div className="mt-2 text-sm text-red-400">{error}</div>
      )}
      <div className="mt-6 flex items-center gap-4">
        <button onClick={onNext} disabled={disabled} className={ok}>
          OK <span className="opacity-60">↵</span>
        </button>
        {optional && (
          <button
            onClick={onNext}
            className="text-base text-neutral-500 hover:text-(--foreground)"
          >
            Skip
          </button>
        )}
        <span className="text-sm text-neutral-600">
          press <Kbd>Enter</Kbd>
        </span>
      </div>
    </div>
  );
}

function NameStatusBadge({ status }: { status: NameStatus }) {
  if (status === "checking")
    return (
      <span className="flex items-center gap-2 rounded-md bg-black/5 dark:bg-white/5 px-2 py-1 text-sm text-neutral-600 dark:text-neutral-400">
        <Spinner /> Checking…
      </span>
    );
  if (status === "ok")
    return (
      <span className="flex items-center gap-1 rounded-md bg-blue-500/15 px-2 py-1 text-sm text-blue-600 dark:text-blue-400">
        ✓ Available
      </span>
    );
  if (status === "taken")
    return (
      <span className="flex items-center gap-1 rounded-md bg-red-500/15 px-2 py-1 text-sm text-red-400">
        × Taken
      </span>
    );
  return null;
}

function BridgeScreen({
  number,
  ghLogin,
  checking,
  warning,
  namespaces,
  onConfirm,
  onForce,
}: {
  number: number;
  ghLogin?: string;
  checking: boolean;
  warning: string | null;
  namespaces: string[];
  onConfirm: () => void;
  onForce: () => void;
}) {
  const [opened, setOpened] = useState(false);
  return (
    <div>
      <QuestionHeader
        number={number}
        title="Let Vercel see your GitHub"
        hint="Vercel needs to read your forked repo to build it. This is a one-time setup."
      />

      {/* What to do on the external page, before we send them there. */}
      <ol className="mb-5 space-y-2 rounded-xl border border-black/10 dark:border-white/10 bg-white/50 dark:bg-black/20 p-4 text-sm text-neutral-700 dark:text-neutral-300">
        <li>
          <b>1.</b> Open the Vercel GitHub app below (new tab).
        </li>
        <li>
          <b>2.</b> Choose the account{ghLogin ? ` @${ghLogin}` : ""} or org that
          holds your fork — not a different one.
        </li>
        <li>
          <b>3.</b> Finish the install/configure step, then{" "}
          <b>come back here</b> and press <b>Check connection</b>.
        </li>
      </ol>

      <a
        href="https://github.com/apps/vercel/installations/new"
        target="_blank"
        rel="noreferrer"
        onClick={() => setOpened(true)}
        className="group flex items-center justify-between rounded-2xl border border-black/10 dark:border-white/10 bg-white/60 dark:bg-black/30 p-6 backdrop-blur-md transition-all hover:border-black/20 dark:hover:border-white/20 hover:bg-white/70 dark:hover:bg-black/40"
      >
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-black/10 dark:bg-white/10">
            <VercelMark />
          </div>
          <div className="text-left">
            <div className="text-xl font-semibold">Install Vercel on GitHub</div>
            <div className="text-sm text-neutral-500">
              Opens in a new tab. Pick the account or org with your fork.
            </div>
          </div>
        </div>
        <span className="text-3xl text-neutral-500 transition-transform group-hover:translate-x-1 group-hover:text-(--foreground)">
          ↗
        </span>
      </a>

      <div className="mt-6 flex items-center gap-4">
        <button onClick={onConfirm} disabled={checking} className={ok}>
          {checking ? (
            <span className="flex items-center gap-2">
              <Spinner /> Checking…
            </span>
          ) : (
            <>Check connection →</>
          )}
        </button>
        {warning && (
          <button
            onClick={onForce}
            className="text-base text-neutral-500 hover:text-(--foreground)"
          >
            Continue anyway
          </button>
        )}
      </div>

      {warning ? (
        <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
          {warning}
          {namespaces.length > 0 && (
            <div className="mt-2 text-amber-700/80 dark:text-amber-300/80">
              Vercel currently sees:{" "}
              {namespaces.map((n) => (
                <code
                  key={n}
                  className="mx-0.5 rounded bg-black/10 px-1 dark:bg-white/10"
                >
                  @{n}
                </code>
              ))}
            </div>
          )}
        </div>
      ) : (
        opened && (
          <div className="mt-4 text-sm text-neutral-500">
            Once you&apos;ve installed it on GitHub, come back here and press{" "}
            &ldquo;Check connection&rdquo; — we verify access before continuing.
          </div>
        )
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
            className="group flex w-full items-center justify-between rounded-2xl border border-black/10 dark:border-white/10 bg-white/60 dark:bg-black/30 p-5 text-left backdrop-blur-md transition-all hover:border-black/20 dark:hover:border-white/20 hover:bg-white/70 dark:hover:bg-black/40"
          >
            <div>
              <div className="text-lg font-semibold">{opt.label}</div>
              <div className="text-sm text-neutral-500">{opt.desc}</div>
            </div>
            <span className="text-2xl text-neutral-500 transition-transform group-hover:translate-x-1 group-hover:text-(--foreground)">
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
                  ? "border-blue-500/50 bg-blue-500/10 backdrop-blur-md"
                  : "border-black/10 dark:border-white/10 bg-white/60 dark:bg-black/30 backdrop-blur-md hover:border-black/20 dark:hover:border-white/20 hover:bg-white/70 dark:hover:bg-black/40",
              ].join(" ")}
            >
              <div>
                <div className="text-lg font-semibold">{c.label}</div>
                <div className="text-sm text-neutral-500">{c.network}</div>
              </div>
              {selected && <span className="text-blue-600 dark:text-blue-400">✓</span>}
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
          <div className="flex items-center justify-between rounded-2xl border border-blue-500/30 bg-blue-500/5 px-5 py-4 text-base">
            <span className="flex items-center gap-3">
              <span className="text-blue-600 dark:text-blue-400">✓</span>
              <code className="text-neutral-800 dark:text-neutral-200">{forkedRepo}</code>
            </span>
            <a
              href={`https://github.com/${forkedRepo}`}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
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
      <dl className="space-y-2 rounded-2xl border border-black/10 dark:border-white/10 bg-white/60 dark:bg-black/30 p-5 text-base backdrop-blur-md">
        <Row label="Project">{projectName}</Row>
        <Row label="Repo">
          <code className="text-neutral-700 dark:text-neutral-300">{forkedRepo}</code>
        </Row>
        <Row label="Chain">{chain?.label ?? chainId}</Row>
        <Row label="Token">
          <code className="text-neutral-700 dark:text-neutral-300">{shortAddr(token)}</code>
        </Row>
        <Row label="Vercel">
          <span className="flex items-center gap-2">
            @{vercelUsername}
            <button
              onClick={onEditVercel}
              className="text-sm text-neutral-500 hover:text-(--foreground)"
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
              className="text-sm text-neutral-500 hover:text-(--foreground)"
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
    <div className="flex items-center justify-between gap-3 border-b border-black/5 dark:border-white/5 py-1.5 last:border-0">
      <dt className="text-sm uppercase tracking-wider text-neutral-500">
        {label}
      </dt>
      <dd className="text-base">{children}</dd>
    </div>
  );
}

function BuildingScreen({
  deployment,
  slow,
  projectName,
  onRefresh,
  onRecheckBridge,
}: {
  deployment: Deployment | null;
  slow: boolean;
  projectName: string;
  onRefresh: () => void;
  onRecheckBridge: () => void;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };
  const state = deployment?.readyState ?? "QUEUED";
  const labels: Record<string, string> = {
    QUEUED: "Queued",
    INITIALIZING: "Initializing",
    BUILDING: "Building",
    READY: "Ready",
    ERROR: "Failed",
    CANCELED: "Canceled",
  };
  // Before the webhook build appears we have no deployment yet — say so
  // honestly rather than implying the build is already running.
  const heading = deployment
    ? `${labels[state] ?? state}…`
    : "Starting your deployment…";
  return (
    <div className="text-center">
      <div className="mx-auto mb-8 flex h-20 w-20 items-center justify-center">
        <div className="relative h-16 w-16">
          <div className="absolute inset-0 rounded-full border-4 border-black/10 dark:border-white/10" />
          <div className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-blue-400" />
        </div>
      </div>
      <h2 className="bg-gradient-to-b from-neutral-900 to-neutral-500 dark:from-white bg-clip-text text-3xl font-semibold tracking-tight text-transparent">
        {heading}
      </h2>
      <p className="mt-3 text-base text-neutral-600 dark:text-neutral-400">
        {deployment
          ? "Your DAO site is being built. This usually takes about 60 seconds."
          : "We've kicked off the build on GitHub — waiting for Vercel to pick it up."}
      </p>
      {slow && (
        <div className="mx-auto mt-4 max-w-md rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
          Still waiting on Vercel to pick up the build. This is usually just a
          slow webhook — we&apos;re still watching. If it never starts, Vercel
          may not have access to your repo;{" "}
          <button
            onClick={onRecheckBridge}
            className="underline underline-offset-2 hover:opacity-80"
          >
            re-check the GitHub connection
          </button>
          .
        </div>
      )}
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3 text-sm">
        <button
          onClick={refresh}
          disabled={refreshing}
          className="rounded-lg border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 px-3 py-2 text-neutral-700 dark:text-neutral-300 hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-50"
        >
          {refreshing ? "Refreshing…" : "Refresh status ↻"}
        </button>
        {deployment?.inspectorUrl && (
          <a
            href={deployment.inspectorUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 px-3 py-2 text-neutral-700 dark:text-neutral-300 hover:bg-black/10 dark:hover:bg-white/10"
          >
            Build logs ↗
          </a>
        )}
        <a
          href={`https://vercel.com/dashboard?query=${encodeURIComponent(projectName)}`}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 px-3 py-2 text-neutral-700 dark:text-neutral-300 hover:bg-black/10 dark:hover:bg-white/10"
        >
          Open in Vercel ↗
        </a>
      </div>
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
        <div className="absolute inset-0 rounded-full bg-blue-500/30 blur-2xl" />
        <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-blue-400 to-blue-600 text-3xl text-black">
          ✓
        </div>
      </div>
      <h2 className="bg-gradient-to-b from-neutral-900 to-neutral-500 dark:from-white bg-clip-text text-5xl font-semibold tracking-tight text-transparent">
        You&apos;re live
      </h2>
      <p className="mt-3 text-base text-neutral-600 dark:text-neutral-400">
        <code className="text-neutral-800 dark:text-neutral-200">{projectName}</code> is deployed.
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
        <div className="mt-8 rounded-xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 p-4 text-base text-neutral-600 dark:text-neutral-400">
          Build still warming up. Open your project dashboard to watch it
          finish.
        </div>
      )}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3 text-sm">
        <a
          href="https://vercel.com/dashboard/projects"
          target="_blank"
          rel="noreferrer"
          className="rounded-lg border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 px-3 py-2 text-neutral-700 dark:text-neutral-300 hover:bg-black/10 dark:hover:bg-white/10"
        >
          Open in Vercel ↗
        </a>
        {deployment?.inspectorUrl && (
          <a
            href={deployment.inspectorUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 px-3 py-2 text-neutral-700 dark:text-neutral-300 hover:bg-black/10 dark:hover:bg-white/10"
          >
            Build logs ↗
          </a>
        )}
        <button
          onClick={onReset}
          className="rounded-lg border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 px-3 py-2 text-neutral-700 dark:text-neutral-300 hover:bg-black/10 dark:hover:bg-white/10"
        >
          Deploy another
        </button>
      </div>
    </div>
  );
}

function ErrorScreen({
  error,
  stage,
  bridgeHint,
  bridge,
  projectName,
  projectId,
  repo,
  onRecheckBridge,
  debugUrl,
  onRetry,
}: {
  error: string | null;
  stage: "create" | "trigger" | "build" | null;
  bridgeHint: string | null;
  bridge: boolean;
  projectName: string | null;
  projectId: string | null;
  repo: string | null;
  onRecheckBridge: () => void;
  debugUrl: string | null;
  onRetry: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const showBridge = bridge || !!bridgeHint;

  // Per-stage framing so the user knows what actually failed and what survived.
  const title =
    stage === "create"
      ? "Couldn't create the Vercel project"
      : stage === "trigger"
        ? "Project created — but the build didn't start"
        : stage === "build"
          ? "The build failed"
          : "Something broke";
  const subtitle =
    stage === "trigger"
      ? "Your project exists on Vercel; we just couldn't push the commit that kicks off the build. Your project link is below."
      : stage === "build"
        ? "Vercel started building but the build errored. Check the logs for the cause."
        : null;

  // Token-safe: none of these values are secrets (tokens live server-side only).
  const debugBlob = JSON.stringify(
    { stage, projectName, projectId, repo, error },
    null,
    2,
  );
  const copyDebug = async () => {
    try {
      await navigator.clipboard.writeText(debugBlob);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — ignore */
    }
  };

  return (
    <div className="text-center">
      <div className="mb-6 inline-flex h-14 w-14 items-center justify-center rounded-full bg-red-500/15 text-3xl text-red-400">
        ×
      </div>
      <h2 className="text-3xl font-semibold tracking-tight">{title}</h2>
      {subtitle && (
        <p className="mx-auto mt-3 max-w-md text-base text-neutral-600 dark:text-neutral-400">
          {subtitle}
        </p>
      )}
      <p className="mx-auto mt-3 max-w-md text-base text-red-600 dark:text-red-200">
        {error ?? "Unknown error"}
      </p>

      {showBridge && (
        <div className="mt-6 flex flex-col items-center gap-3">
          <a
            href="https://github.com/apps/vercel/installations/new"
            target="_blank"
            rel="noreferrer"
            className={`${cta} inline-flex`}
          >
            Install Vercel on GitHub →
          </a>
          <button
            onClick={onRecheckBridge}
            className="text-sm text-neutral-500 hover:text-(--foreground)"
          >
            Re-check the connection
          </button>
        </div>
      )}

      {projectName && (
        <a
          href={`https://vercel.com/dashboard?query=${encodeURIComponent(projectName)}`}
          target="_blank"
          rel="noreferrer"
          className="mt-6 inline-flex items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-sm text-blue-700 dark:text-blue-300 hover:bg-blue-500/20"
        >
          Open <code>{projectName}</code> in Vercel ↗
        </a>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3 text-sm">
        <button
          onClick={onRetry}
          className="rounded-lg border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 px-3 py-2 text-neutral-700 dark:text-neutral-300 hover:bg-black/10 dark:hover:bg-white/10"
        >
          ← Try again
        </button>
        <button
          onClick={copyDebug}
          className="rounded-lg border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 px-3 py-2 text-neutral-700 dark:text-neutral-300 hover:bg-black/10 dark:hover:bg-white/10"
        >
          {copied ? "Copied ✓" : "Copy debug info"}
        </button>
        {debugUrl && (
          <a
            href={debugUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 px-3 py-2 text-neutral-700 dark:text-neutral-300 hover:bg-black/10 dark:hover:bg-white/10"
          >
            Open debug info ↗
          </a>
        )}
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
        <div className="mb-3 inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">
          {number} →
        </div>
      )}
      <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        {title}
      </h2>
      {hint && <p className="mt-3 text-base text-neutral-600 dark:text-neutral-400">{hint}</p>}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-black/15 bg-black/5 px-1.5 py-0.5 font-mono text-[10px] text-neutral-800 dark:border-white/15 dark:bg-white/10 dark:text-neutral-200">
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
    <svg viewBox="0 0 76 65" className="h-5 w-5 fill-neutral-900 dark:fill-white">
      <path d="M37.527.182l37.527 64.99H0L37.527.182z" />
    </svg>
  );
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" className="h-5 w-5 fill-neutral-900 dark:fill-white">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

type ThemeMode = "light" | "dark" | "system";

function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>("system");

  useEffect(() => {
    const stored = (localStorage.getItem("theme") as ThemeMode | null) ?? "system";
    setMode(stored);
  }, []);

  useEffect(() => {
    if (mode !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () =>
      document.documentElement.classList.toggle("dark", mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode]);

  const apply = (next: ThemeMode) => {
    setMode(next);
    if (next === "system") {
      localStorage.removeItem("theme");
      const sysDark = matchMedia("(prefers-color-scheme: dark)").matches;
      document.documentElement.classList.toggle("dark", sysDark);
    } else {
      localStorage.setItem("theme", next);
      document.documentElement.classList.toggle("dark", next === "dark");
    }
  };

  const order: ThemeMode[] = ["system", "dark", "light"];
  const nextMode = order[(order.indexOf(mode) + 1) % order.length];
  const cycle = () => apply(nextMode);

  const labels: Record<ThemeMode, string> = {
    system: "Auto",
    dark: "Dark",
    light: "Light",
  };

  return (
    <button
      onClick={cycle}
      title={`Theme: ${labels[mode]} — click to switch to ${labels[nextMode]}`}
      className="fixed right-6 top-6 z-40 rounded-full border border-black/10 dark:border-white/10 bg-white/70 dark:bg-black/40 px-3 py-1.5 text-sm text-neutral-800 dark:text-neutral-200 backdrop-blur hover:text-(--foreground)"
    >
      {labels[nextMode]}
    </button>
  );
}

function BackgroundGlow() {
  return (
    <>
      <div
        className="bg-scrim pointer-events-none fixed inset-0"
        style={{ zIndex: 1 }}
      />
      <div
        className="pointer-events-none fixed inset-0"
        style={{ zIndex: 0 }}
      >
      <PixelBlast
        variant="square"
        pixelSize={5}
        color="#3B82F6"
        patternScale={2.5}
        patternDensity={1.4}
        pixelSizeJitter={0.4}
        enableRipples
        rippleSpeed={0.4}
        rippleThickness={0.12}
        rippleIntensityScale={1.5}
        liquid
        liquidStrength={0.12}
        liquidRadius={1.2}
        liquidWobbleSpeed={5}
        speed={0.6}
        edgeFade={0}
        transparent
      />
      </div>
    </>
  );
}

function shortAddr(a: string): string {
  if (!a) return "";
  if (a.length <= 12) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

const cta =
  "inline-flex w-full items-center justify-center rounded-xl bg-gradient-to-b from-neutral-900 to-black py-3.5 text-lg font-semibold text-white shadow-lg shadow-black/30 transition-all hover:from-neutral-800 hover:to-neutral-900 disabled:cursor-not-allowed disabled:opacity-30 disabled:shadow-none dark:from-white dark:to-neutral-200 dark:text-neutral-950 dark:shadow-white/10 dark:hover:from-neutral-100 dark:hover:to-neutral-300";

const primary =
  "inline-flex w-full items-center justify-center rounded-xl bg-gradient-to-b from-neutral-900 to-black py-3 text-base font-semibold text-white shadow-lg shadow-black/30 transition-all hover:from-neutral-800 hover:to-neutral-900 disabled:cursor-not-allowed disabled:opacity-30 disabled:shadow-none dark:from-white dark:to-neutral-200 dark:text-neutral-950 dark:shadow-white/10 dark:hover:from-neutral-100 dark:hover:to-neutral-300";

const ok =
  "inline-flex items-center gap-2 rounded-lg bg-gradient-to-b from-blue-400 to-blue-500 px-5 py-2.5 text-base font-semibold text-black shadow-lg shadow-blue-500/20 transition-all hover:from-blue-300 hover:to-blue-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none";

const bigInput =
  "w-full border-b-2 border-black/20 dark:border-white/20 bg-transparent px-1 py-3 text-3xl font-medium text-neutral-900 dark:text-white outline-none transition-colors placeholder:text-neutral-400 dark:placeholder:text-neutral-600 focus:border-blue-400";
