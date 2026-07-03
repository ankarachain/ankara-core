import ora from "ora";
import inquirer from "inquirer";
import { ethers } from "ethers";
import { MULTI_TOKEN_FACTORY_ABI } from "@ankarachain/sdk";
import { logger } from "../utils/logger.js";
import {
  readConfig,
  addDeployment,
  getPrivateKey,
  getRpcUrl,
} from "../utils/config.js";

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

  const oracleAddress = details.oracle.trim() || ethers.ZeroAddress;
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
    const privateKey = getPrivateKey();
    const rpcUrl     = getRpcUrl(config);
    const provider   = new ethers.JsonRpcProvider(rpcUrl);
    const wallet     = new ethers.Wallet(privateKey, provider);

    const factory = new ethers.Contract(
      config.multiTokenFactoryAddress,
      MULTI_TOKEN_FACTORY_ABI,
      wallet
    );

    const tx = await factory.deployPoolVault(
      details.name,
      details.symbol,
      assetIdBytes,
      details.countryCode,
      wallet.address,
      ethers.ZeroAddress,   // verifier
      oracleAddress,
      BigInt(feeBps)
    );
    const receipt = await tx.wait();

    const iface = new ethers.Interface(MULTI_TOKEN_FACTORY_ABI as readonly string[]);
    let contractAddress = "";
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === "MultiTokenDeployed") {
          contractAddress = parsed.args.contractAddress;
          break;
        }
      } catch {}
    }

    spinner.succeed(`PoolVault deployed: ${contractAddress}`);

    addDeployment({
      tokenAddress: contractAddress,
      assetId:      assetIdBytes,
      template:     "pool-vault",
      name:         details.name,
      symbol:       details.symbol,
      countryCode:  details.countryCode,
      txHash:       receipt.hash,
      deployedAt:   Date.now(),
      network:      config.network,
    });

    logger.blank();
    logger.info(`Contract : ${contractAddress}`);
    logger.info(`Tx hash  : ${receipt.hash}`);
    logger.info("Saved to ankara.config.json");
  } catch (err: any) {
    spinner.fail("Deployment failed");
    logger.error(err.message ?? String(err));
    process.exit(1);
  }
}
