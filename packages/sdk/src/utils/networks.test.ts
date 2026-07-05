import { describe, it, expect } from "vitest";
import { getNetwork, NETWORKS } from "./networks";
import type { EVMSupportedNetwork, SupportedNetwork } from "../types";

const EVM_NETWORKS: EVMSupportedNetwork[] = [
  "polygon-amoy",
  "polygon",
  "ethereum",
  "bnb",
  "celo",
  "localhost",
];

const STELLAR_NETWORKS: SupportedNetwork[] = ["stellar", "stellar-testnet"];

const ALL_NETWORKS: SupportedNetwork[] = [...EVM_NETWORKS, ...STELLAR_NETWORKS];

describe("NETWORKS", () => {
  it("contains exactly 8 supported networks", () => {
    expect(Object.keys(NETWORKS)).toHaveLength(8);
  });

  it("contains all expected network keys", () => {
    for (const n of ALL_NETWORKS) {
      expect(NETWORKS[n], `missing network: ${n}`).toBeDefined();
    }
  });

  it("each EVM entry has the required fields", () => {
    for (const n of EVM_NETWORKS) {
      const cfg = NETWORKS[n];
      expect(cfg.chainFamily, `${n}.chainFamily`).toBe("evm");
      if (cfg.chainFamily !== "evm") continue;
      expect(typeof cfg.chainId, `${n}.chainId`).toBe("number");
      expect(cfg.chainId, `${n}.chainId > 0`).toBeGreaterThan(0);
      expect(cfg.name, `${n}.name`).toBeTruthy();
      expect(cfg.rpcUrl, `${n}.rpcUrl`).toBeTruthy();
      expect(cfg.nativeCurrency, `${n}.nativeCurrency`).toBeDefined();
      expect(cfg.nativeCurrency.symbol, `${n}.nativeCurrency.symbol`).toBeTruthy();
      expect(cfg.nativeCurrency.decimals, `${n}.nativeCurrency.decimals`).toBe(18);
    }
  });

  it("each Stellar entry has the required fields", () => {
    for (const n of STELLAR_NETWORKS) {
      const cfg = NETWORKS[n];
      expect(cfg.chainFamily, `${n}.chainFamily`).toBe("stellar");
      if (cfg.chainFamily !== "stellar") continue;
      expect(cfg.networkPassphrase, `${n}.networkPassphrase`).toBeTruthy();
      expect(cfg.name, `${n}.name`).toBeTruthy();
      expect(cfg.nativeCurrency.symbol, `${n}.nativeCurrency.symbol`).toBe("XLM");
      expect(cfg.nativeCurrency.decimals, `${n}.nativeCurrency.decimals`).toBe(7);
    }
  });

  it("has distinct EVM chain IDs", () => {
    const ids = EVM_NETWORKS.map((n) => {
      const cfg = NETWORKS[n];
      return cfg.chainFamily === "evm" ? cfg.chainId : null;
    });
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("polygon-amoy is chainId 80002", () => {
    const cfg = NETWORKS["polygon-amoy"];
    expect(cfg.chainFamily === "evm" && cfg.chainId).toBe(80002);
  });

  it("polygon mainnet is chainId 137", () => {
    const cfg = NETWORKS["polygon"];
    expect(cfg.chainFamily === "evm" && cfg.chainId).toBe(137);
  });

  it("ethereum is chainId 1", () => {
    const cfg = NETWORKS["ethereum"];
    expect(cfg.chainFamily === "evm" && cfg.chainId).toBe(1);
  });

  it("bnb is chainId 56", () => {
    const cfg = NETWORKS["bnb"];
    expect(cfg.chainFamily === "evm" && cfg.chainId).toBe(56);
  });

  it("celo is chainId 42220", () => {
    const cfg = NETWORKS["celo"];
    expect(cfg.chainFamily === "evm" && cfg.chainId).toBe(42220);
  });

  it("localhost is chainId 31337", () => {
    const cfg = NETWORKS["localhost"];
    expect(cfg.chainFamily === "evm" && cfg.chainId).toBe(31337);
  });

  it("stellar-testnet uses the SDF testnet passphrase", () => {
    const cfg = NETWORKS["stellar-testnet"];
    expect(cfg.chainFamily === "stellar" && cfg.networkPassphrase).toBe(
      "Test SDF Network ; September 2015"
    );
  });
});

describe("getNetwork", () => {
  it("returns config for each supported network", () => {
    for (const n of ALL_NETWORKS) {
      const cfg = getNetwork(n);
      expect(cfg).toBeDefined();
    }
  });

  it("returns the same object as NETWORKS[key]", () => {
    for (const n of ALL_NETWORKS) {
      expect(getNetwork(n)).toBe(NETWORKS[n]);
    }
  });

  it("throws for an unsupported network name", () => {
    expect(() => getNetwork("base" as SupportedNetwork)).toThrow();
    expect(() => getNetwork("" as SupportedNetwork)).toThrow();
  });

  it("is case-sensitive — 'Polygon' is not valid", () => {
    expect(() => getNetwork("Polygon" as SupportedNetwork)).toThrow();
  });
});
