import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { SupportedNetwork } from "@ankarachain/sdk";

export interface AnkaraChainProjectConfig {
  version:        string;
  network:        SupportedNetwork;
  factoryAddress: string;
  rpcUrl?:        string;
  deployments:    DeploymentRecord[];
}

export interface DeploymentRecord {
  tokenAddress: string;
  assetId:      string;
  template:     string;
  name:         string;
  symbol:       string;
  countryCode:  string;
  txHash:       string;
  deployedAt:   number;
  network:      string;
}

const CONFIG_FILE = "ankara.config.json";

export function configExists(): boolean {
  return existsSync(join(process.cwd(), CONFIG_FILE));
}

export function readConfig(): AnkaraChainProjectConfig {
  const path = join(process.cwd(), CONFIG_FILE);
  if (!existsSync(path)) {
    throw new Error(
      "No ankara.config.json found. Run: npx ankara init"
    );
  }
  return JSON.parse(readFileSync(path, "utf-8"));
}

export function writeConfig(config: AnkaraChainProjectConfig): void {
  const path = join(process.cwd(), CONFIG_FILE);
  writeFileSync(path, JSON.stringify(config, null, 2));
}

export function addDeployment(
  record: DeploymentRecord
): void {
  const config = readConfig();
  config.deployments.push(record);
  writeConfig(config);
}

export function getPrivateKey(): string {
  const key = process.env.PRIVATE_KEY;
  if (!key) {
    throw new Error(
      "PRIVATE_KEY not set. Add it to your .env file:\n  PRIVATE_KEY=your_key_here"
    );
  }
  return key.startsWith("0x") ? key : `0x${key}`;
}

export function getRpcUrl(config: AnkaraChainProjectConfig): string {
  return (
    process.env.RPC_URL ??
    config.rpcUrl ??
    ""
  );
}
