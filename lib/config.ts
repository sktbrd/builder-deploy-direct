export const ENV_KEYS = [
  "NEXT_PUBLIC_NETWORK_TYPE",
  "NEXT_PUBLIC_CHAIN_ID",
  "NEXT_PUBLIC_DAO_TOKEN_ADDRESS",
  "NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID",
  "NEXT_PUBLIC_ALCHEMY_API_KEY",
  "PINATA_API_KEY",
  "NEXT_PUBLIC_PINATA_GATEWAY",
  "NEXT_PUBLIC_SITE_URL",
] as const;

export type EnvKey = (typeof ENV_KEYS)[number];

export const CHAIN_OPTIONS = [
  { id: "1", label: "Ethereum Mainnet", network: "mainnet" },
  { id: "8453", label: "Base", network: "mainnet" },
  { id: "17000", label: "Holesky (testnet)", network: "testnet" },
  { id: "84532", label: "Base Sepolia (testnet)", network: "testnet" },
] as const;

export type DeployConfig = {
  projectName: string;
  githubRepo: string;
  teamId?: string;
  env: Record<EnvKey, string>;
};