import { describe, it, expect, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";

const calls: Array<{ method: string; args: Record<string, unknown> }> = [];
vi.mock("@stellar/stellar-sdk/contract", async () => {
  const actual = await vi.importActual<typeof import("@stellar/stellar-sdk/contract")>("@stellar/stellar-sdk/contract");
  return {
    ...actual,
    Client: {
      from: vi.fn(async () => new Proxy({}, {
        get: (_t, method: string) => method === "then" ? undefined : async (args: Record<string, unknown>) => {
          calls.push({ method, args });
          return { result: "CNEWVAULT", signAndSend: async () => ({ result: "CNEWVAULT", getTransactionResponse: { txHash: "h" } }) };
        },
      })),
    },
  };
});

import { StellarAdapter } from "./stellar";

describe("StellarAdapter.deployPoolVault governance option", () => {
  const adapter = new StellarAdapter("stellar-testnet", {
    network: "stellar-testnet",
    stellarSecretKey: Keypair.random().secret(),
    multiTokenFactoryAddress: "CFACTORY",
  });
  const base = { name: "Coop Fund", symbol: "COOP", assetId: "COOP-1", countryCode: "NG" };

  it("uses deploy_pool_vault by default", async () => {
    await adapter.deployPoolVault(base);
    expect(calls.at(-1)!.method).toBe("deploy_pool_vault");
    expect(calls.at(-1)!.args.governance_config).toBeUndefined();
  });

  it("uses deploy_governed_pool_vault with a snake_case config when governance is set", async () => {
    const out = await adapter.deployPoolVault({
      ...base,
      governance: { votingPeriod: 259200n, timelock: 86400n, quorumBps: 2000, proposalThresholdBps: 100 },
    });
    expect(out.contractAddress).toBe("CNEWVAULT");
    expect(calls.at(-1)!.method).toBe("deploy_governed_pool_vault");
    expect(calls.at(-1)!.args.governance_config).toEqual({
      voting_period: 259200n, timelock: 86400n, quorum_bps: 2000, proposal_threshold_bps: 100,
    });
  });
});
