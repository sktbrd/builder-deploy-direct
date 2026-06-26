"use client";

import { useEffect, useRef, useState } from "react";

// A Chrome-dino-style endless runner where the player is a Nouns ⌐◨-◨ noggles
// that hops obstacles and collects Ξ. Pure canvas; nothing leaves the client.
// Lives on the building screen to make the ~minute-long deploy wait fun.

// Official Nouns noggles outline (from the nouns.wtf nav), drawn in a 160×60
// coordinate space. Rendered verbatim via Path2D so proportions are exact.
const NOGGLES_PATH = new Path2D(
  "M0 50V20h30V0h60v20h10V0h60v60h-60V30H90v30H30V30H10v20z",
);
const NOGGLES_W = 160;
const NOGGLES_H = 60;
const NOGGLES_RED = "rgb(213, 60, 94)";
const OBSTACLE = "#4b5563"; // distinct from the player

function drawNoggles(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = NOGGLES_RED;
  ctx.fill(NOGGLES_PATH);
  ctx.restore();
}

type Obstacle = { x: number; w: number; h: number };
type Coin = { x: number; y: number; taken: boolean };

export default function NogglesRunner() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [over, setOver] = useState(false);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const stored = Number(localStorage.getItem("noggles-best") || "0");
    if (Number.isFinite(stored)) setBest(stored);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    const groundY = H - 26;
    const NOG_SCALE = 0.34; // scale the 160×60 logo to sprite size
    const nogW = NOGGLES_W * NOG_SCALE;
    const nogH = NOGGLES_H * NOG_SCALE;

    const state = {
      px: 44,
      py: groundY - nogH,
      vy: 0,
      onGround: true,
      speed: 4.2,
      dist: 0,
      coins: 0,
      obstacles: [] as Obstacle[],
      coinList: [] as Coin[],
      spawnT: 0,
      coinT: 0,
      running: false,
      dead: false,
      raf: 0,
    };

    const GRAVITY = 0.7;
    const JUMP = -11.5;

    const jump = () => {
      if (state.dead) {
        reset();
        return;
      }
      if (!state.running) {
        state.running = true;
        setStarted(true);
      }
      if (state.onGround) {
        state.vy = JUMP;
        state.onGround = false;
      }
    };

    function reset() {
      state.px = 44;
      state.py = groundY - nogH;
      state.vy = 0;
      state.onGround = true;
      state.speed = 4.2;
      state.dist = 0;
      state.coins = 0;
      state.obstacles = [];
      state.coinList = [];
      state.spawnT = 0;
      state.coinT = 0;
      state.dead = false;
      state.running = true;
      setOver(false);
      setScore(0);
    }

    const rectHit = (ax: number, ay: number, aw: number, ah: number, o: Obstacle) =>
      ax < o.x + o.w &&
      ax + aw > o.x &&
      ay < groundY &&
      ay + ah > groundY - o.h;

    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min((now - last) / 16.6667, 2.5);
      last = now;
      ctx.clearRect(0, 0, W, H);

      // ground
      ctx.strokeStyle = "rgba(120,130,150,0.5)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, groundY);
      ctx.lineTo(W, groundY);
      ctx.stroke();

      if (state.running && !state.dead) {
        state.dist += state.speed * dt;
        state.speed += 0.0016 * dt;

        // physics
        state.vy += GRAVITY * dt;
        state.py += state.vy * dt;
        if (state.py >= groundY - nogH) {
          state.py = groundY - nogH;
          state.vy = 0;
          state.onGround = true;
        }

        // spawn obstacles
        state.spawnT -= dt;
        if (state.spawnT <= 0) {
          const h = 16 + Math.floor((state.dist % 5) ) * 4 + (state.coins % 3) * 4;
          state.obstacles.push({ x: W + 10, w: 14 + (state.obstacles.length % 2) * 8, h: Math.min(h, 46) });
          state.spawnT = 70 + ((state.dist * 7) % 50);
        }
        // spawn coins
        state.coinT -= dt;
        if (state.coinT <= 0) {
          state.coinList.push({ x: W + 30, y: groundY - nogH - 18 - ((state.dist * 13) % 30), taken: false });
          state.coinT = 90 + ((state.dist * 11) % 70);
        }

        // move + collide obstacles
        for (const o of state.obstacles) o.x -= state.speed * dt;
        state.obstacles = state.obstacles.filter((o) => o.x + o.w > -4);
        for (const o of state.obstacles) {
          if (rectHit(state.px, state.py, nogW, nogH, o)) {
            state.dead = true;
            state.running = false;
            const sc = Math.floor(state.dist / 10) + state.coins * 10;
            setScore(sc);
            setOver(true);
            setBest((b) => {
              const nb = Math.max(b, sc);
              localStorage.setItem("noggles-best", String(nb));
              return nb;
            });
          }
        }

        // coins
        for (const c of state.coinList) c.x -= state.speed * dt;
        state.coinList = state.coinList.filter((c) => c.x > -20 && !c.taken);
        for (const c of state.coinList) {
          if (
            !c.taken &&
            state.px < c.x + 12 &&
            state.px + nogW > c.x - 12 &&
            state.py < c.y + 12 &&
            state.py + nogH > c.y - 12
          ) {
            c.taken = true;
            state.coins += 1;
          }
        }

        if (Math.floor(state.dist) % 4 === 0)
          setScore(Math.floor(state.dist / 10) + state.coins * 10);
      }

      // draw obstacles
      ctx.fillStyle = OBSTACLE;
      for (const o of state.obstacles) {
        ctx.fillRect(o.x, groundY - o.h, o.w, o.h);
      }

      // draw coins as little ETH diamonds (losangos) — the octahedron logo
      for (const c of state.coinList) {
        if (c.taken) continue;
        const w = 7;
        const h = 11;
        // upper facets (lighter)
        ctx.fillStyle = "#7c9bff";
        ctx.beginPath();
        ctx.moveTo(c.x, c.y - h);
        ctx.lineTo(c.x + w, c.y);
        ctx.lineTo(c.x, c.y + 1);
        ctx.lineTo(c.x - w, c.y);
        ctx.closePath();
        ctx.fill();
        // lower facets (darker)
        ctx.fillStyle = "#3B82F6";
        ctx.beginPath();
        ctx.moveTo(c.x - w, c.y);
        ctx.lineTo(c.x, c.y + 1);
        ctx.lineTo(c.x + w, c.y);
        ctx.lineTo(c.x, c.y + h);
        ctx.closePath();
        ctx.fill();
      }

      // draw noggles
      drawNoggles(ctx, state.px, state.py, NOG_SCALE);

      state.raf = requestAnimationFrame(loop);
    };
    state.raf = requestAnimationFrame(loop);

    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp") {
        e.preventDefault();
        jump();
      }
    };
    const onPointer = (e: Event) => {
      e.preventDefault();
      jump();
    };
    window.addEventListener("keydown", onKey);
    canvas.addEventListener("pointerdown", onPointer);

    return () => {
      cancelAnimationFrame(state.raf);
      window.removeEventListener("keydown", onKey);
      canvas.removeEventListener("pointerdown", onPointer);
    };
  }, []);

  return (
    <div className="select-none">
      <div className="mb-1 flex items-center justify-between text-xs text-neutral-500">
        <span>
          {started ? "" : "Press Space / tap to play · "}jump the gas, grab the Ξ
        </span>
        <span className="tabular-nums">
          {score} {best > 0 && <span className="opacity-60">· best {best}</span>}
        </span>
      </div>
      <div className="relative overflow-hidden rounded-xl border border-black/10 bg-white/60 dark:border-white/10 dark:bg-black/30">
        <canvas
          ref={canvasRef}
          className="block h-[180px] w-full cursor-pointer"
        />
        {over && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/5 dark:bg-black/20">
            <div className="text-lg font-semibold text-neutral-900 dark:text-white">
              Wrecked! {score} pts
            </div>
            <div className="text-sm text-neutral-600 dark:text-neutral-300">
              Space / tap to run again
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
