import { NextResponse } from "next/server";
import { subgraphUrl, toGatewayUrl, subgraphQuery } from "@/lib/subgraph";

export const runtime = "nodejs";

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
  if (!subgraphUrl(chainId)) {
    return NextResponse.json(
      { error: "Unsupported chain", unsupportedChain: true },
      { status: 400 },
    );
  }

  const data = await subgraphQuery<{
    dao?: { name?: string; contractImage?: string } | null;
  }>(chainId, QUERY, { id: token.toLowerCase() });

  if (data === null) {
    return NextResponse.json({ error: "Lookup failed" }, { status: 502 });
  }
  if (!data.dao) {
    return NextResponse.json({ found: false });
  }
  return NextResponse.json({
    found: true,
    name: data.dao.name ?? null,
    image: toGatewayUrl(data.dao.contractImage),
  });
}
