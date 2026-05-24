import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const STATE_TTL_MS = 10 * 60 * 1000;

function secret(): string {
  const s =
    process.env.OAUTH_STATE_SECRET ||
    process.env.GITHUB_CLIENT_SECRET ||
    process.env.VERCEL_CLIENT_SECRET;
  if (!s) throw new Error("No secret available for state signing");
  return s;
}

export function signState(payload: { next?: string } = {}): string {
  const ts = Date.now().toString(36);
  const nonce = randomBytes(8).toString("hex");
  const next = payload.next ? encodeURIComponent(payload.next) : "";
  const body = `${ts}.${nonce}.${next}`;
  const sig = createHmac("sha256", secret()).update(body).digest("hex");
  return `${body}.${sig}`;
}

export function verifyState(state: string | null):
  | { ok: true; next?: string }
  | { ok: false; reason: string } {
  if (!state) return { ok: false, reason: "missing" };
  const parts = state.split(".");
  if (parts.length !== 4) return { ok: false, reason: "format" };
  const [ts, nonce, next, sig] = parts;
  const body = `${ts}.${nonce}.${next}`;
  const expected = createHmac("sha256", secret()).update(body).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "signature" };
  }
  const tsMs = parseInt(ts, 36);
  if (!Number.isFinite(tsMs) || Date.now() - tsMs > STATE_TTL_MS) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, next: next ? decodeURIComponent(next) : undefined };
}
