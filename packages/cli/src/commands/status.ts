import { ethers } from "ethers";
import { AssetRegistry } from "@ankarachain/sdk";
import { logger } from "../utils/logger.js";
import { readConfig } from "../utils/config.js";
import { buildAdapter } from "../utils/adapter.js";

const STATUS_LABELS: Record<number, string> = {
  0: "DRAFT",
  1: "ACTIVE",
  2: "SUSPENDED",
  3: "REDEEMED",
  4: "EXPIRED",
};

export async function statusCommand(tokenAddress?: string) {
  logger.blank();
  console.log("  📋  Asset Status");
  logger.divider();
  logger.blank();

  const config = readConfig();

  // If no address given, list all deployments
  if (!tokenAddress) {
    if (config.deployments.length === 0) {
      logger.info("No deployments found in ankara.config.json");
      logger.info("Deploy a token first: npx ankara deploy");
      logger.blank();
      return;
    }

    logger.info(`Found ${config.deployments.length} deployment(s) on ${config.network}:`);
    logger.blank();

    for (const d of config.deployments) {
      logger.label("Name:",    d.name);
      logger.label("Symbol:",  d.symbol);
      logger.label("Address:", d.tokenAddress);
      logger.label("Template:", d.template);
      logger.label("Country:", d.countryCode);
      logger.label("Deployed:", new Date(d.deployedAt * 1000).toLocaleString());
      logger.blank();
    }
    return;
  }

  // Fetch live status from chain (read-only — no signing key required)
  const adapter = buildAdapter(config, { readOnly: true });

  // Try to figure out template from saved deployments
  const saved = config.deployments.find(
    d => d.tokenAddress.toLowerCase() === tokenAddress.toLowerCase()
  );
  const template = (saved?.template as "farmland" | "commodity") ?? "farmland";

  const registry = new AssetRegistry(adapter, tokenAddress, template);

  try {
    const [name, symbol, status, country, valuation, version] = await Promise.all([
      registry.getName(),
      registry.getSymbol(),
      registry.getStatus(),
      registry.getCountryCode(),
      registry.getValuationUSD(),
      registry.getVersion(),
    ]);

    logger.label("Name:",            name);
    logger.label("Symbol:",          symbol);
    logger.label("Address:",         tokenAddress);
    logger.label("Country:",         country);
    logger.label("Status:",          STATUS_LABELS[status] ?? String(status));
    logger.label("Valuation USD:",   ethers.formatEther(valuation));
    logger.label("Metadata version:", String(version));
    logger.blank();

  } catch (err: any) {
    logger.error(`Failed to fetch status: ${err.message}`);
    process.exit(1);
  }
}
