import ora from "ora";
import inquirer from "inquirer";
import { ethers } from "ethers";
import { TokenFactory } from "@ankarachain/sdk";
import { logger } from "../utils/logger.js";
import { readConfig, addDeployment } from "../utils/config.js";
import { buildAnkaraChainConfig } from "../utils/adapter.js";

export async function deployPoolCommand() {
  logger.blank();
  console.log("  🏦  Deploy Pool Vault (multi-asset ERC-20 fund)");
  logger.divider();
  logger.blank();

  const config = readConfig();

  if (!config.multiTokenFactoryAddress) {
    logger.error("No multiTokenFactoryAddress in ankara.config.json");
    logger.info('Add your deployed MultiTokenFactory address: "multiTokenFactoryAddress": "0x..."');
    process.exit(1);
  }

  const details = await inquirer.prompt([
    { type: "input", name: "name",              message: "Pool name:",                         default: "West Africa Commodity Pool" },
    { type: "input", name: "symbol",            message: "Pool symbol (3-5 chars):",           default: "WACP" },
    { type: "input", name: "assetId",           message: "Asset ID (unique string):",          default: "POOL-001" },
    { type: "input", name: "countryCode",        message: "Country code (ISO 3166-1 alpha-2):", default: "NG" },
    { type: "input", name: "oracle",            message: "Oracle address (leave blank for none):", default: "" },
    { type: "input", name: "managementFeeBps",  message: "Management fee bps (default 50 = 0.5%/yr):", default: "50" },
  ]);

  // `undefined` (not a chain-specific zero-address) so "no oracle" round-trips
  // correctly to both EVMAdapter (falls back to ethers.ZeroAddress itself)
  // and StellarAdapter (maps to Soroban's `Option<Address>::None`).
  const oracleAddress: string | undefined = details.oracle.trim() || undefined;
  const feeBps        = parseInt(details.managementFeeBps, 10) || 50;
  const assetIdBytes  = ethers.keccak256(ethers.toUtf8Bytes(details.assetId));

  logger.blank();
  logger.divider();
  logger.info(`Name        : ${details.name}`);
  logger.info(`Symbol      : ${details.symbol}`);
  logger.info(`Asset ID    : ${details.assetId}`);
  logger.info(`Country     : ${details.countryCode}`);
  logger.info(`Fee bps     : ${feeBps}`);
  logger.info(`Oracle      : ${oracleAddress}`);
  logger.info(`Network     : ${config.network}`);
  logger.divider();
  logger.blank();

  const { confirmed } = await inquirer.prompt([{
    type: "confirm",
    name: "confirmed",
    message: "Deploy this PoolVault contract?",
    default: true,
  }]);

  if (!confirmed) {
    logger.info("Cancelled.");
    return;
  }

  const spinner = ora("Deploying PoolVault…").start();
  try {
    const factory = new TokenFactory(buildAnkaraChainConfig(config));

    const result = await factory.deployPoolVault({
      name:        details.name,
      symbol:      details.symbol,
      assetId:     details.assetId,
      countryCode: details.countryCode,
      oracle:      oracleAddress,
      managementFeeBps: feeBps,
    });

    spinner.succeed(`PoolVault deployed: ${result.contractAddress}`);

    addDeployment({
      tokenAddress: result.contractAddress,
      assetId:      assetIdBytes,
      template:     "pool-vault",
      name:         details.name,
      symbol:       details.symbol,
      countryCode:  details.countryCode,
      txHash:       result.txHash,
      deployedAt:   result.deployedAt,
      network:      config.network,
    });

    logger.blank();
    logger.info(`Contract : ${result.contractAddress}`);
    logger.info(`Tx hash  : ${result.txHash}`);
    logger.info("Saved to ankara.config.json");
  } catch (err: any) {
    spinner.fail("Deployment failed");
    logger.error(err.message ?? String(err));
    process.exit(1);
  }
}
