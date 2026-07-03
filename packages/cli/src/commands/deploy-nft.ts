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

type NFTTemplate =
  | "farmland-nft"
  | "real-estate-nft"
  | "mining-rights-nft"
  | "commodity-vault-nft";

export async function deployNFTCommand() {
  logger.blank();
  console.log("  🖼️  Deploy NFT Asset Record");
  logger.divider();
  logger.blank();

  const config = readConfig();

  if (!config.nftFactoryAddress) {
    logger.error("No nftFactoryAddress in ankara.config.json");
    logger.info("Add your deployed NFTFactory address to ankara.config.json:");
    logger.info('  "nftFactoryAddress": "0x..."');
    process.exit(1);
  }

  // ── Template selection ────────────────────────────────────────────────────
  const { template } = await inquirer.prompt([{
    type: "list",
    name: "template",
    message: "NFT template:",
    choices: [
      { name: "Farmland NFT        — unique land parcel deed",         value: "farmland-nft"        },
      { name: "Real Estate NFT     — unique property title",           value: "real-estate-nft"     },
      { name: "Mining Rights NFT   — unique mining license",           value: "mining-rights-nft"   },
      { name: "Commodity Vault NFT — certified warehouse receipt",     value: "commodity-vault-nft" },
    ],
  }]);
  const nftTemplate = template as NFTTemplate;

  // ── Common fields ─────────────────────────────────────────────────────────
  const details = await inquirer.prompt([
    { type: "input", name: "name",        message: "Collection name:",              default: "My NFT" },
    { type: "input", name: "symbol",      message: "Collection symbol (3-5 chars):", default: "MNFT" },
    { type: "input", name: "assetId",     message: "Asset ID (unique string):",     default: `${nftTemplate.toUpperCase()}-001` },
    { type: "input", name: "countryCode", message: "Country code (ISO 3166-1 alpha-2):", default: "NG" },
  ]);

  // ── Confirmation ──────────────────────────────────────────────────────────
  logger.blank();
  logger.divider();
  logger.info(`Template    : ${nftTemplate}`);
  logger.info(`Name        : ${details.name}`);
  logger.info(`Symbol      : ${details.symbol}`);
  logger.info(`Asset ID    : ${details.assetId}`);
  logger.info(`Country     : ${details.countryCode}`);
  logger.info(`Network     : ${config.network}`);
  logger.divider();
  logger.blank();

  const { confirmed } = await inquirer.prompt([{
    type: "confirm",
    name: "confirmed",
    message: "Deploy this NFT contract?",
    default: true,
  }]);

  if (!confirmed) {
    logger.info("Cancelled.");
    return;
  }

  // ── Deploy ────────────────────────────────────────────────────────────────
  const privateKey = getPrivateKey();
  const rpcUrl     = getRpcUrl(config);

  const provider = rpcUrl
    ? new ethers.JsonRpcProvider(rpcUrl)
    : new ethers.JsonRpcProvider();

  const signer = new ethers.Wallet(privateKey, provider);

  const factory = new TokenFactory({
    network:           config.network,
    signer,
    nftFactoryAddress: config.nftFactoryAddress,
  });

  const spinner = ora("Deploying NFT contract...").start();

  try {
    const baseOpts = {
      name:        details.name,
      symbol:      details.symbol,
      assetId:     details.assetId,
      countryCode: details.countryCode,
    };

    let result: any;

    switch (nftTemplate) {
      case "farmland-nft":
        result = await factory.deployFarmlandNFT({ ...baseOpts, metadata: { location: "", areaSqMeters: 0n, soilType: "", irrigationType: "", cropHistory: "", titleDocumentHash: ethers.ZeroHash, surveyReportHash: ethers.ZeroHash, stateRegion: "", lastUpdated: 0n } });
        break;
      case "real-estate-nft":
        result = await factory.deployRealEstateNFT({ ...baseOpts, metadata: { propertyId: "", propertyType: "", locationAddress: "", totalAreaSqMeters: 0n, titleDocumentHash: ethers.ZeroHash, valuationUSD: 0n, rentalYieldBps: 0n, developerAddress: ethers.ZeroAddress, lastUpdated: 0n } });
        break;
      case "mining-rights-nft":
        result = await factory.deployMiningRightsNFT({ ...baseOpts, metadata: { licenseNumber: "", mineralType: "", concessionArea: "", areaHectares: 0n, licenseExpiry: 0n, issuingAuthority: "", licenseDocumentHash: ethers.ZeroHash, royaltyRateBps: 0n, lastUpdated: 0n } });
        break;
      case "commodity-vault-nft":
        result = await factory.deployCommodityVaultNFT({ ...baseOpts, metadata: { warehouseId: "", warehouseLocation: "", operatorAddress: ethers.ZeroAddress, commodityType: "", quantityKg: 0n, gradeClassification: "", certificateHash: ethers.ZeroHash, depositDate: 0n, lastUpdated: 0n } });
        break;
    }

    spinner.succeed(`NFT contract deployed!`);
    logger.blank();
    logger.success(`NFT Address : ${result.nftAddress}`);
    logger.success(`Tx Hash     : ${result.txHash}`);
    logger.info(`Template    : ${result.template}`);
    logger.info(`Network     : ${result.network}`);

    addDeployment({
      tokenAddress: result.nftAddress,
      assetId:      details.assetId,
      template:     nftTemplate,
      name:         details.name,
      symbol:       details.symbol,
      countryCode:  details.countryCode,
      txHash:       result.txHash,
      deployedAt:   result.deployedAt,
      network:      config.network,
    });

  } catch (err: any) {
    spinner.fail("Deployment failed");
    logger.error(err.message ?? String(err));
    process.exit(1);
  }
}
