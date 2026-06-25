import { NextResponse } from "next/server";
import { CHAIN_OPTIONS } from "@/lib/config";
import { toGatewayUrl, subgraphQuery } from "@/lib/subgraph";

export const runtime = "nodejs";

// Smart DAO finder: fans out across every chain the deployer supports.
// - a 0x address  → resolve that exact DAO on each chain (dao(id))
// - free text     → name_contains_nocase search on each chain
// Each result carries its chainId so the client can set chain + token together.

const BY_ID = `query Dao($id: ID!) {
  dao(id: $id) { name contractImage tokenAddress }
}`;

const BY_NAME = `query Daos($q: String!) {
  daos(first: 5, where: { name_contains_nocase: $q }) {
    name contractImage tokenAddress
  }
}`;

type DaoRow = { name?: string; contractImage?: string; tokenAddress?: string };

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (!q) return NextResponse.json({ results: [] });

  const isAddress = /^0x[a-fA-F0-9]{40}$/.test(q);

  const perChain = await Promise.all(
    CHAIN_OPTIONS.map(async (chain) => {
      const rows: DaoRow[] = [];
      if (isAddress) {
        const data = await subgraphQuery<{ dao?: DaoRow | null }>(
          chain.id,
          BY_ID,
          { id: q.toLowerCase() },
        );
        if (data?.dao) rows.push(data.dao);
      } else {
        const data = await subgraphQuery<{ daos?: DaoRow[] }>(chain.id, BY_NAME, {
          q,
        });
        if (data?.daos) rows.push(...data.daos);
      }
      return rows
        .filter((d) => d.tokenAddress)
        .map((d) => ({
          chainId: chain.id,
          chainLabel: chain.label,
          network: chain.network,
          name: d.name ?? "Unnamed DAO",
          image: toGatewayUrl(d.contractImage),
          tokenAddress: (d.tokenAddress as string).toLowerCase(),
        }));
    }),
  );

  // Flatten, de-dupe by chain+token, cap the list.
  const seen = new Set<string>();
  const results = perChain.flat().filter((r) => {
    const key = `${r.chainId}:${r.tokenAddress}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return NextResponse.json({ results: results.slice(0, 8) });
}
