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

    const factory = new ethers.Contract(
      config.multiTokenFactoryAddress,
      MULTI_TOKEN_FACTORY_ABI,
      wallet
    );

    const warehouseMeta = {
      warehouseId:          details.warehouseId,
      warehouseLocation:    details.warehouseLocation,
      operatorAddress:      wallet.address,
      warehouseLicenseHash: ethers.ZeroHash,
      certificationExpiry:  BigInt(9_999_999_999),
    };

    const tx = await factory.deployCommodityBatchToken(
      details.name,
      details.countryCode,
      details.baseURI,
      wallet.address,
      warehouseMeta
    );
    const receipt = await tx.wait();

    // Parse contract address from event
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

    spinner.succeed(`CommodityBatchToken deployed: ${contractAddress}`);

    addDeployment({
      tokenAddress: contractAddress,
      assetId:      ethers.ZeroHash,
      template:     "commodity-batch",
      name:         details.name,
      symbol:       "ERC1155",
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
