import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface IndexerConfig {
  port: number;
  dataDir: string;
  rpcUrl: string;
  /** Soroban contract IDs to index events for. */
  contracts: string[];
  pollIntervalMs: number;
  /** How many ledgers back to start from on first run, if no cursor is saved yet. Soroban RPC only retains a limited recent-ledger window anyway. */
  initialLedgerLookback: number;
}

/**
 * Reads `../contracts-stellar/deployments.testnet.json` (written by
 * `deploy-testnet.sh`, see Workstream 1) if present, and returns every
 * contract address in it — this is how the indexer knows what to watch
 * without duplicating addresses into its own env config by hand.
 */
function contractsFromDeploymentsFile(): string[] {
  const candidate = path.resolve(__dirname, "../../contracts-stellar/deployments.testnet.json");
  if (!existsSync(candidate)) return [];
  try {
    const parsed = JSON.parse(readFileSync(candidate, "utf8")) as { contracts?: Record<string, string> };
    return Object.values(parsed.contracts ?? {}).filter((v): v is string => typeof v === "string" && v.length > 0);
  } catch {
    return [];
  }
}

export function loadConfig(): IndexerConfig {
  const envContracts = (process.env.INDEXER_CONTRACTS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const contracts = envContracts.length > 0 ? envContracts : contractsFromDeploymentsFile();

  return {
    port: Number(process.env.PORT ?? 4100),
    dataDir: process.env.DATA_DIR ?? "./data",
    rpcUrl: process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org",
    contracts,
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 10_000),
    initialLedgerLookback: Number(process.env.INITIAL_LEDGER_LOOKBACK ?? 17_280), // ~1 day of ledgers
  };
}
