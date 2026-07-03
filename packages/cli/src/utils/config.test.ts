import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  configExists,
  readConfig,
  writeConfig,
  addDeployment,
  getPrivateKey,
  getRpcUrl,
  type AnkaraChainProjectConfig,
} from "./config";

const baseConfig: AnkaraChainProjectConfig = {
  version: "0.0.1",
  network: "localhost",
  factoryAddress: "0x1111111111111111111111111111111111111111",
  deployments: [],
};

describe("config", () => {
  let dir: string;
  let cwd: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ankara-cli-test-"));
    cwd = process.cwd();
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
    delete process.env.PRIVATE_KEY;
    delete process.env.RPC_URL;
  });

  describe("configExists", () => {
    it("returns false when no ankara.config.json exists", () => {
      expect(configExists()).toBe(false);
    });

    it("returns true after writeConfig", () => {
      writeConfig(baseConfig);
      expect(configExists()).toBe(true);
    });
  });

  describe("readConfig / writeConfig", () => {
    it("round-trips a config written to disk", () => {
      writeConfig(baseConfig);
      const loaded = readConfig();
      expect(loaded).toEqual(baseConfig);
    });

    it("throws a helpful error when no config file exists", () => {
      expect(() => readConfig()).toThrow(/npx ankara init/);
    });
  });

  describe("addDeployment", () => {
    it("appends a deployment record and persists it", () => {
      writeConfig(baseConfig);
      addDeployment({
        tokenAddress: "0x2222222222222222222222222222222222222222",
        assetId: "KANO-FARM-001",
        template: "farmland",
        name: "Kano Farmland Token",
        symbol: "KFT",
        countryCode: "NG",
        txHash: "0xabc",
        deployedAt: 1712345678,
        network: "localhost",
      });

      const loaded = readConfig();
      expect(loaded.deployments).toHaveLength(1);
      expect(loaded.deployments[0].tokenAddress).toBe("0x2222222222222222222222222222222222222222");
    });

    it("accumulates multiple deployments in order", () => {
      writeConfig(baseConfig);
      addDeployment({ tokenAddress: "0xA", assetId: "A", template: "farmland", name: "A", symbol: "A", countryCode: "NG", txHash: "0x1", deployedAt: 1, network: "localhost" });
      addDeployment({ tokenAddress: "0xB", assetId: "B", template: "commodity", name: "B", symbol: "B", countryCode: "NG", txHash: "0x2", deployedAt: 2, network: "localhost" });

      const loaded = readConfig();
      expect(loaded.deployments.map(d => d.tokenAddress)).toEqual(["0xA", "0xB"]);
    });
  });

  describe("getPrivateKey", () => {
    it("throws when PRIVATE_KEY is not set", () => {
      expect(() => getPrivateKey()).toThrow(/PRIVATE_KEY not set/);
    });

    it("returns the key unmodified when already 0x-prefixed", () => {
      process.env.PRIVATE_KEY = "0xabc123";
      expect(getPrivateKey()).toBe("0xabc123");
    });

    it("adds a 0x prefix when missing", () => {
      process.env.PRIVATE_KEY = "abc123";
      expect(getPrivateKey()).toBe("0xabc123");
    });
  });

  describe("getRpcUrl", () => {
    it("falls back to config.rpcUrl when RPC_URL env var is unset", () => {
      expect(getRpcUrl({ ...baseConfig, rpcUrl: "https://config-rpc.example" })).toBe("https://config-rpc.example");
    });

    it("prefers the RPC_URL env var over config.rpcUrl", () => {
      process.env.RPC_URL = "https://env-rpc.example";
      expect(getRpcUrl({ ...baseConfig, rpcUrl: "https://config-rpc.example" })).toBe("https://env-rpc.example");
    });

    it("returns an empty string when neither is set", () => {
      expect(getRpcUrl(baseConfig)).toBe("");
    });
  });
});
