import ora from "ora";
import inquirer from "inquirer";
import { ethers } from "ethers";
import { TokenFactory, NETWORKS } from "@ankarachain/sdk";
import { logger } from "../utils/logger.js";
import {
  readConfig,
  addDeployment,
  getPrivateKey,
  getRpcUrl,
} from "../utils/config.js";

type Template = "farmland" | "commodity";

export async function deployCommand(opts: { template?: string }) {
  logger.blank();
  console.log("  🚀  Deploy RWA Token");
  logger.divider();
  logger.blank();

  const config = readConfig();

  if (!config.factoryAddress) {
    logger.error("No factory address in ankara.config.json");
    logger.info("Run: npx ankara deploy-factory — or set factoryAddress manually.");
    process.exit(1);
  }

  // ── Template selection ────────────────────────────────────────────────────
  let template = opts.template as Template | undefined;
  if (!template) {
    const ans = await inquirer.prompt([{
      type: "list",
      name: "template",
      message: "Asset template:",
      choices: [
        { name: "Farmland          — agricultural land tokenization", value: "farmland"  },
        { name: "Commodity Receipt — warehouse receipt tokenization", value: "commodity" },
      ],
    }]);
    template = ans.template as Template;
  }

  // ── Token details ─────────────────────────────────────────────────────────
  const details = await inquirer.prompt([
    { type: "input",  name: "name",        message: "Token name:",             default: template === "farmland" ? "My Farmland Token" : "My Commodity Token" },
    { type: "input",  name: "symbol",      message: "Token symbol (3-5 chars):", default: template === "farmland" ? "MFT" : "MCT" },
    { type: "input",  name: "assetId",     message: "Asset ID (unique string):", default: `${template.toUpperCase()}-001` },
    { type: "input",  name: "countryCode", message: "Country code (ISO 3166-1 alpha-2):", default: "NG" },
  ]);

  // ── Template-specific fields ──────────────────────────────────────────────
  let metadata: any;

  if (template === "farmland") {
    const m = await inquirer.prompt([
      { type: "input",  name: "location",       message: "GPS location:",          default: "12.0022, 8.5919" },
      { type: "number", name: "areaSqMeters",   message: "Area (sq metres):",      default: 10000 },
      { type: "input",  name: "soilType",       message: "Soil type:",             default: "loam" },
      { type: "input",  name: "irrigationType", message: "Irrigation type:",       default: "rain-fed" },
      { type: "input",  name: "cropHistory",    message: "Crop history:",          default: "maize,sorghum,fallow" },
      { type: "input",  name: "stateRegion",    message: "State / Region:",        default: "Kano State" },
      { type: "number", name: "valuationUSD",   message: "Valuation USD (whole):", default: 50000 },
    ]);

    metadata = {
      location:          m.location,
      areaSqMeters:      BigInt(m.areaSqMeters),
      soilType:          m.soilType,
      irrigationType:    m.irrigationType,
      cropHistory:       m.cropHistory,
      titleDocumentHash: ethers.ZeroHash,
      valuationUSD:      ethers.parseEther(String(m.valuationUSD)),
      stateRegion:       m.stateRegion,
      lastUpdated:       BigInt(Math.floor(Date.now() / 1000)),
    };

  } else {
    const m = await inquirer.prompt([
      { type: "input",  name: "commodityType",       message: "Commodity type:",    default: "maize" },
      { type: "number", name: "quantityKg",          message: "Quantity (kg):",     default: 5000 },
      { type: "input",  name: "gradeClassification", message: "Grade:",             default: "Grade A" },
      { type: "input",  name: "warehouseId",         message: "Warehouse ID:",      default: "WH-001" },
      { type: "input",  name: "warehouseLocation",   message: "Warehouse location:", default: "Lagos, Nigeria" },
      { type: "input",  name: "harvestSeason",       message: "Harvest season:",    default: "2025/2026" },
      { type: "number", name: "valuationUSD",        message: "Valuation USD:",     default: 10000 },
    ]);

    const now      = BigInt(Math.floor(Date.now() / 1000));
    const sixMonths = BigInt(60 * 60 * 24 * 180);

    metadata = {
      commodityType:       m.commodityType,
      quantityKg:          BigInt(m.quantityKg),
      gradeClassification: m.gradeClassification,
      warehouseId:         m.warehouseId,
      warehouseLocation:   m.warehouseLocation,
      depositDate:         now,
      expiryDate:          now + sixMonths,
      inspectionReportHash: ethers.ZeroHash,
      valuationUSD:        ethers.parseEther(String(m.valuationUSD)),
      harvestSeason:       m.harvestSeason,
      lastUpdated:         now,
    };
  }

  // ── Confirm ───────────────────────────────────────────────────────────────
  logger.blank();
  logger.divider();
  logger.label("Template:",  template);
  logger.label("Name:",      details.name);
  logger.label("Symbol:",    details.symbol);
  logger.label("Asset ID:",  details.assetId);
  logger.label("Country:",   details.countryCode);
  logger.label("Network:",   config.network);
  logger.divider();
  logger.blank();

  const { confirm } = await inquirer.prompt([{
    type: "confirm",
    name: "confirm",
    message: "Deploy this token?",
    default: true,
  }]);

  if (!confirm) { logger.info("Cancelled."); return; }

  // ── Deploy ────────────────────────────────────────────────────────────────
  const spinner = ora("Deploying...").start();

  try {
    const privateKey = getPrivateKey();
    const rpcUrl     = getRpcUrl(config);
    const network    = NETWORKS[config.network];
    const provider   = new ethers.JsonRpcProvider(
      rpcUrl || network.rpcUrl,
      network.chainId
    );
    const signer = new ethers.Wallet(privateKey, provider);

    const factory = new TokenFactory({
      network:        config.network,
      signer,
      factoryAddress: config.factoryAddress,
      rpcUrl:         rpcUrl || undefined,
    });

    let result;
    if (template === "farmland") {
      result = await factory.deployFarmland({
        name:        details.name,
        symbol:      details.symbol,
        assetId:     details.assetId,
        countryCode: details.countryCode,
        metadata,
      });
    } else {
      result = await factory.deployCommodity({
        name:        details.name,
        symbol:      details.symbol,
        assetId:     details.assetId,
        countryCode: details.countryCode,
        metadata,
      });
    }

    spinner.succeed("Token deployed!");

    // ── Save to config ──────────────────────────────────────────────────────
    addDeployment({
      tokenAddress: result.tokenAddress,
      assetId:      result.assetId,
      template:     result.template,
      name:         details.name,
      symbol:       details.symbol,
      countryCode:  details.countryCode,
      txHash:       result.txHash,
      deployedAt:   result.deployedAt,
      network:      result.network,
    });

    logger.blank();
    logger.divider();
    logger.success("Token deployed successfully!");
    logger.blank();
    logger.label("Token address:", result.tokenAddress);
    logger.label("Tx hash:",       result.txHash);
    logger.label("Network:",       config.network);
    logger.blank();

    if (config.network === "polygon-amoy") {
      logger.info(`View on explorer: https://amoy.polygonscan.com/address/${result.tokenAddress}`);
    }

    logger.blank();
    logger.info("Saved to ankara.config.json");
    logger.divider();
    logger.blank();

  } catch (err: any) {
    spinner.fail("Deployment failed");
    logger.blank();
    logger.error(err.message ?? String(err));
    logger.blank();
    process.exit(1);
  }
}
