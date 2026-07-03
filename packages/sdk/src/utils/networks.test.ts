import { describe, it, expect } from "vitest";
import { getNetwork, NETWORKS } from "./networks";
import type { SupportedNetwork } from "../types";

const ALL_NETWORKS: SupportedNetwork[] = [
  "polygon-amoy",
  "polygon",
  "ethereum",
  "bnb",
  "celo",
  "localhost",
];

describe("NETWORKS", () => {
  it("contains exactly 6 supported networks", () => {
    expect(Object.keys(NETWORKS)).toHaveLength(6);
  });

  it("contains all expected network keys", () => {
    for (const n of ALL_NETWORKS) {
      expect(NETWORKS[n], `missing network: ${n}`).toBeDefined();
    }
  });

  it("each entry has the required fields", () => {
    for (const [name, cfg] of Object.entries(NETWORKS)) {
      expect(typeof cfg.chainId,  `${name}.chainId`).toBe("number");
      expect(cfg.chainId,         `${name}.chainId > 0`).toBeGreaterThan(0);
      expect(cfg.name,            `${name}.name`).toBeTruthy();
      expect(cfg.rpcUrl,          `${name}.rpcUrl`).toBeTruthy();
      expect(cfg.nativeCurrency,  `${name}.nativeCurrency`).toBeDefined();
      expect(cfg.nativeCurrency.symbol, `${name}.nativeCurrency.symbol`).toBeTruthy();
      expect(cfg.nativeCurrency.decimals, `${name}.nativeCurrency.decimals`).toBe(18);
    }
  });

  it("has distinct chain IDs", () => {
    const ids = Object.values(NETWORKS).map((c) => c.chainId);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("polygon-amoy is chainId 80002", () => {
    expect(NETWORKS["polygon-amoy"].chainId).toBe(80002);
  });

  it("polygon mainnet is chainId 137", () => {
    expect(NETWORKS["polygon"].chainId).toBe(137);
  });

  it("ethereum is chainId 1", () => {
    expect(NETWORKS["ethereum"].chainId).toBe(1);
  });

  it("bnb is chainId 56", () => {
    expect(NETWORKS["bnb"].chainId).toBe(56);
  });

  it("celo is chainId 42220", () => {
    expect(NETWORKS["celo"].chainId).toBe(42220);
  });

  it("localhost is chainId 31337", () => {
    expect(NETWORKS["localhost"].chainId).toBe(31337);
  });
});

describe("getNetwork", () => {
  it("returns config for each supported network", () => {
    for (const n of ALL_NETWORKS) {
      const cfg = getNetwork(n);
      expect(cfg).toBeDefined();
      expect(cfg.chainId).toBeGreaterThan(0);
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
