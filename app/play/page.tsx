"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";

const PixelBlast = dynamic(() => import("@/components/PixelBlast"), {
  ssr: false,
});
const NogglesRunner = dynamic(() => import("@/components/NogglesRunner"), {
  ssr: false,
});

// Standalone Noggles Runner — playable on its own, and a way to preview the
// game without running a full DAO deploy.
export default function PlayPage() {
  // Match the deployer's stored theme so dark/light is consistent.
  useEffect(() => {
    const stored = localStorage.getItem("theme");
    const dark =
      stored === "dark" ||
      (!stored && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  }, []);

  return (
    <div className="relative min-h-screen overflow-hidden text-neutral-900 dark:text-white">
      <div
        className="bg-scrim pointer-events-none fixed inset-0"
        style={{ zIndex: 1 }}
      />
      <div className="pointer-events-none fixed inset-0" style={{ zIndex: 0 }}>
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

      <main className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6 py-16">
        <div className="w-full max-w-2xl">
          <div className="mb-6 text-center">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-blue-600/40 bg-blue-500/15 px-3 py-1 text-sm font-medium text-blue-800 backdrop-blur dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-200">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-600 dark:bg-blue-400" />
              Noggles Runner
            </div>
            <h1 className="text-4xl font-semibold tracking-tight text-neutral-900 dark:text-white sm:text-5xl">
              Jump the gas, grab the{" "}
              <span className="bg-gradient-to-r from-blue-700 to-blue-500 bg-clip-text text-transparent dark:from-blue-300 dark:to-blue-100">
                Ξ
              </span>
            </h1>
            <p className="mx-auto mt-3 max-w-md text-neutral-600 dark:text-neutral-300">
              Press <Kbd>Space</Kbd> or tap to jump. How far can the noggles run?
            </p>
          </div>

          <NogglesRunner />

          <div className="mt-6 text-center text-sm">
            <Link
              href="/"
              className="text-blue-700 underline-offset-2 hover:underline dark:text-blue-300"
            >
              ← Back to the DAO deployer
            </Link>
          </div>
        </div>
      </main>
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
