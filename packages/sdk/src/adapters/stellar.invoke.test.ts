import { describe, it, expect, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";

// Mock the dynamic contract.Client so no network call happens — same
// approach as stellar.test.ts.
const calls: Array<{ method: string; args: unknown }> = [];
vi.mock("@stellar/stellar-sdk/contract", async () => {
  const actual = await vi.importActual<typeof import("@stellar/stellar-sdk/contract")>("@stellar/stellar-sdk/contract");
  return {
    ...actual,
    Client: {
      from: vi.fn(async () => new Proxy({}, {
        // `then` must stay undefined or `await Client.from()` treats the proxy as a thenable.
        get: (_t, method: string) => method === "then" ? undefined : async (args: unknown) => {
          calls.push({ method, args });
          return {
            result: `read:${method}`,
            signAndSend: async () => ({ result: `wrote:${method}`, getTransactionResponse: { txHash: "hash-1" } }),
          };
        },
      })),
    },
  };
});

import { StellarAdapter } from "./stellar";

describe("StellarAdapter generic invocation", () => {
  const adapter = new StellarAdapter("stellar-testnet", {
    network: "stellar-testnet",
    stellarSecretKey: Keypair.random().secret(),
  });

  it("invokeContract signs, sends and returns result + tx hash", async () => {
    const out = await adapter.invokeContract("CX", "do_thing", { a: 1 });
    expect(out).toEqual({ result: "wrote:do_thing", txHash: "hash-1" });
    expect(calls.at(-1)).toEqual({ method: "do_thing", args: { a: 1 } });
  });

  it("readContract returns the simulated result without sending", async () => {
    expect(await adapter.readContract("CX", "get_thing")).toBe("read:get_thing");
    expect(calls.at(-1)).toEqual({ method: "get_thing", args: {} });
  });
});
