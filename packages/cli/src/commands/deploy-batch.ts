import ora from "ora";
import inquirer from "inquirer";
import { ethers } from "ethers";
import { TokenFactory } from "@ankarachain/sdk";
import { logger } from "../utils/logger.js";
import {
  readConfig,
  addDeployment,
  getPrivateKey,
  getRpcUrl,
} from "../utils/config.js";

export async function deployBatchCommand() {
  logger.blank();
  console.log("  📦  Deploy Commodity Batch Token (ERC-1155)");
  logger.divider();
  logger.blank();

  const config = readConfig();

  if (!config.multiTokenFactoryAddress) {
    logger.error("No multiTokenFactoryAddress in ankara.config.json");
    logger.info("Add your deployed MultiTokenFactory address:");
    logger.info('  "multiTokenFactoryAddress": "0x..."');
    process.exit(1);
  }

  const details = await inquirer.prompt([
    { type: "input", name: "name",              message: "Warehouse name:",                   default: "Lagos Cocoa Warehouse" },
    { type: "input", name: "countryCode",        message: "Country code (ISO 3166-1 alpha-2):", default: "NG" },
    { type: "input", name: "baseURI",            message: "Base IPFS URI:",                    default: "ipfs://QmYourCID/" },
    { type: "input", name: "warehouseId",        message: "Warehouse ID:",                     default: "WH-001" },
    { type: "input", name: "warehouseLocation",  message: "Warehouse location:",               default: "Apapa, Lagos" },
  ]);

  logger.blank();
  logger.divider();
  logger.info(`Name        : ${details.name}`);
  logger.info(`Country     : ${details.countryCode}`);
  logger.info(`Warehouse ID: ${details.warehouseId}`);
  logger.info(`Location    : ${details.warehouseLocation}`);
  logger.info(`Network     : ${config.network}`);
  logger.divider();
  logger.blank();

  const { confirmed } = await inquirer.prompt([{
    type: "confirm",
    name: "confirmed",
    message: "Deploy this CommodityBatchToken contract?",
    default: true,
  }]);

  if (!confirmed) {
    logger.info("Cancelled.");
    return;
  }

  const spinner = ora("Deploying CommodityBatchToken…").start();
  try {
    const privateKey = getPrivateKey();
    const rpcUrl     = getRpcUrl(config);
    const provider   = new ethers.JsonRpcProvider(rpcUrl);
    const wallet     = new ethers.Wallet(privateKey, provider);

    const factory = new TokenFactory({
      network: config.network,
      signer: wallet,
      multiTokenFactoryAddress: config.multiTokenFactoryAddress,
    });

    const result = await factory.deployCommodityBatchToken({
      name:        details.name,
      countryCode: details.countryCode,
      baseURI:     details.baseURI,
      warehouse: {
        warehouseId:       details.warehouseId,
        warehouseLocation: details.warehouseLocation,
      },
    });

    spinner.succeed(`CommodityBatchToken deployed: ${result.contractAddress}`);

    addDeployment({
      tokenAddress: result.contractAddress,
      assetId:      ethers.ZeroHash,
      template:     "commodity-batch",
      name:         details.name,
      symbol:       "ERC1155",
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
