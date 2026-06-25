// Nouns Builder subgraphs (Goldsky). chainId → subgraph slug.
const PROJECT = "project_cm33ek8kjx6pz010i2c3w8z25";

export const SUBGRAPH: Record<string, string> = {
  "1": "nouns-builder-ethereum-mainnet",
  "11155111": "nouns-builder-ethereum-sepolia",
  "8453": "nouns-builder-base-mainnet",
  "84532": "nouns-builder-base-sepolia",
  "10": "nouns-builder-optimism-mainnet",
  "11155420": "nouns-builder-optimism-sepolia",
  "7777777": "nouns-builder-zora-mainnet",
  "999999999": "nouns-builder-zora-sepolia",
};

export const subgraphUrl = (chainId: string): string | null =>
  SUBGRAPH[chainId]
    ? `https://api.goldsky.com/api/public/${PROJECT}/subgraphs/${SUBGRAPH[chainId]}/latest/gn`
    : null;

// contractImage comes back as ipfs://<cid> — rewrite to a fetchable gateway.
// http(s) and data: URIs are already usable as-is.
export function toGatewayUrl(img: string | null | undefined): string | null {
  if (!img) return null;
  if (img.startsWith("ipfs://")) {
    return `https://ipfs.io/ipfs/${img.slice("ipfs://".length)}`;
  }
  return img;
}

// Minimal typed GraphQL POST against a chain's subgraph. Returns null on any
// transport/HTTP error so callers can degrade gracefully.
export async function subgraphQuery<T>(
  chainId: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T | null> {
  const url = subgraphUrl(chainId);
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: T };
    return json.data ?? null;
  } catch {
    return null;
  }
}
