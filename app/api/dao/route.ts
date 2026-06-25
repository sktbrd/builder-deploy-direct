import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Nouns Builder subgraphs (Goldsky). chainId → subgraph slug.
const PROJECT = "project_cm33ek8kjx6pz010i2c3w8z25";
const SUBGRAPH: Record<string, string> = {
  "1": "nouns-builder-ethereum-mainnet",
  "11155111": "nouns-builder-ethereum-sepolia",
  "8453": "nouns-builder-base-mainnet",
  "84532": "nouns-builder-base-sepolia",
  "10": "nouns-builder-optimism-mainnet",
  "11155420": "nouns-builder-optimism-sepolia",
  "7777777": "nouns-builder-zora-mainnet",
  "999999999": "nouns-builder-zora-sepolia",
};

const subgraphUrl = (chainId: string) =>
  SUBGRAPH[chainId]
    ? `https://api.goldsky.com/api/public/${PROJECT}/subgraphs/${SUBGRAPH[chainId]}/latest/gn`
    : null;

// contractImage comes back as ipfs://<cid> — rewrite to a fetchable gateway.
// http(s) and data: URIs are already usable as-is.
function toGatewayUrl(img: string | null | undefined): string | null {
  if (!img) return null;
  if (img.startsWith("ipfs://")) {
    return `https://ipfs.io/ipfs/${img.slice("ipfs://".length)}`;
  }
  return img;
}

const QUERY = `query Dao($id: ID!) { dao(id: $id) { name contractImage } }`;

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const chainId = params.get("chainId");
  const token = params.get("token");

  if (!chainId || !token) {
    return NextResponse.json({ error: "Missing chainId or token" }, { status: 400 });
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(token)) {
    return NextResponse.json({ error: "Invalid token address" }, { status: 400 });
  }
  const url = subgraphUrl(chainId);
  if (!url) {
    return NextResponse.json(
      { error: "Unsupported chain", unsupportedChain: true },
      { status: 400 },
    );
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: QUERY, variables: { id: token.toLowerCase() } }),
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Subgraph ${res.status}` },
        { status: 502 },
      );
    }
    const json = (await res.json()) as {
      data?: { dao?: { name?: string; contractImage?: string } | null };
    };
    const dao = json.data?.dao;
    if (!dao) {
      return NextResponse.json({ found: false });
    }
    return NextResponse.json({
      found: true,
      name: dao.name ?? null,
      image: toGatewayUrl(dao.contractImage),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Lookup failed" },
      { status: 502 },
    );
  }
}
