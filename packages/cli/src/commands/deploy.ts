import ora from "ora";
import inquirer from "inquirer";
import { ethers } from "ethers";
import { TokenFactory } from "@ankarachain/sdk";
import { logger } from "../utils/logger.js";
import { readConfig, addDeployment } from "../utils/config.js";
import { buildAnkaraChainConfig } from "../utils/adapter.js";

type Template =
  | "farmland"
  | "commodity"
  | "real-estate"
  | "invoice"
  | "carbon-credit"
  | "mining-rights";

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
        { name: "Farmland          — agricultural land tokenization",    value: "farmland"      },
        { name: "Commodity Receipt — warehouse receipt tokenization",    value: "commodity"     },
        { name: "Real Estate       — property tokenization",             value: "real-estate"   },
        { name: "Invoice           — trade finance / receivables",       value: "invoice"       },
        { name: "Carbon Credit     — emissions credit tokenization",     value: "carbon-credit" },
        { name: "Mining Rights     — mineral license tokenization",      value: "mining-rights" },
      ],
    }]);
    template = ans.template as Template;
  }

  // ── Token details ─────────────────────────────────────────────────────────
  const defaultNames: Record<Template, string> = {
    "farmland":      "My Farmland Token",
    "commodity":     "My Commodity Token",
    "real-estate":   "My Real Estate Token",
    "invoice":       "My Invoice Token",
    "carbon-credit": "My Carbon Credit Token",
    "mining-rights": "My Mining Rights Token",
  };
  const defaultSymbols: Record<Template, string> = {
    "farmland":      "MFT",
    "commodity":     "MCT",
    "real-estate":   "MRT",
    "invoice":       "MIT",
    "carbon-credit": "MCC",
    "mining-rights": "MMR",
  };

  const details = await inquirer.prompt([
    { type: "input", name: "name",        message: "Token name:",                   default: defaultNames[template!] },
    { type: "input", name: "symbol",      message: "Token symbol (3-5 chars):",     default: defaultSymbols[template!] },
    { type: "input", name: "assetId",     message: "Asset ID (unique string):",     default: `${template!.toUpperCase()}-001` },
    { type: "input", name: "countryCode", message: "Country code (ISO 3166-1 alpha-2):", default: "NG" },
  ]);

  // ── Template-specific fields ──────────────────────────────────────────────
  let metadata: any;
  const now = BigInt(Math.floor(Date.now() / 1000));

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
      lastUpdated:       now,
    };

  } else if (template === "commodity") {
    const m = await inquirer.prompt([
      { type: "input",  name: "commodityType",       message: "Commodity type:",     default: "maize" },
      { type: "number", name: "quantityKg",          message: "Quantity (kg):",      default: 5000 },
      { type: "input",  name: "gradeClassification", message: "Grade:",              default: "Grade A" },
      { type: "input",  name: "warehouseId",         message: "Warehouse ID:",       default: "WH-001" },
      { type: "input",  name: "warehouseLocation",   message: "Warehouse location:", default: "Lagos, Nigeria" },
      { type: "input",  name: "harvestSeason",       message: "Harvest season:",     default: "2025/2026" },
      { type: "number", name: "valuationUSD",        message: "Valuation USD:",      default: 10000 },
    ]);
    const sixMonths = BigInt(60 * 60 * 24 * 180);
    metadata = {
      commodityType:        m.commodityType,
      quantityKg:           BigInt(m.quantityKg),
      gradeClassification:  m.gradeClassification,
      warehouseId:          m.warehouseId,
      warehouseLocation:    m.warehouseLocation,
      depositDate:          now,
      expiryDate:           now + sixMonths,
      inspectionReportHash: ethers.ZeroHash,
      valuationUSD:         ethers.parseEther(String(m.valuationUSD)),
      harvestSeason:        m.harvestSeason,
      lastUpdated:          now,
    };

  } else if (template === "real-estate") {
    const m = await inquirer.prompt([
      { type: "input",  name: "propertyId",       message: "Property ID:",            default: "PROP-001" },
      { type: "list",   name: "propertyType",     message: "Property type:",          choices: ["Residential", "Commercial", "Industrial", "Land"], default: "Residential" },
      { type: "input",  name: "locationAddress",  message: "Location address:",       default: "12 Victoria Island, Lagos" },
      { type: "number", name: "totalAreaSqMeters",message: "Total area (sq metres):", default: 200 },
      { type: "list",   name: "occupancyStatus",  message: "Occupancy status:",       choices: ["Vacant", "Owner-occupied", "Tenanted"], default: "Vacant" },
      { type: "number", name: "rentalYieldBps",   message: "Rental yield (bps, e.g. 600 = 6%):", default: 600 },
      { type: "number", name: "valuationUSD",     message: "Valuation USD (whole):",  default: 250000 },
    ]);
    metadata = {
      propertyId:        m.propertyId,
      propertyType:      m.propertyType,
      locationAddress:   m.locationAddress,
      totalAreaSqMeters: BigInt(m.totalAreaSqMeters),
      titleDocumentHash: ethers.ZeroHash,
      valuationUSD:      ethers.parseEther(String(m.valuationUSD)),
      rentalYieldBps:    BigInt(m.rentalYieldBps),
      occupancyStatus:   m.occupancyStatus,
      developerAddress:  ethers.ZeroAddress,
      lastUpdated:       now,
    };

  } else if (template === "invoice") {
    const m = await inquirer.prompt([
      { type: "input",  name: "invoiceNumber",   message: "Invoice number:",              default: "INV-2025-001" },
      { type: "input",  name: "debtorReference", message: "Debtor reference:",            default: "DEBTOR-001" },
      { type: "number", name: "faceValueUSD",    message: "Face value USD (whole):",      default: 100000 },
      { type: "number", name: "discountRateBps", message: "Discount rate (bps, e.g. 200 = 2%):", default: 200 },
      { type: "number", name: "dueDays",         message: "Days until due:",              default: 90 },
      { type: "input",  name: "currency",        message: "Currency (ISO 4217):",         default: "USD" },
    ]);
    const dueDays = BigInt(m.dueDays) * BigInt(60 * 60 * 24);
    metadata = {
      invoiceNumber:       m.invoiceNumber,
      debtorReference:     m.debtorReference,
      faceValueUSD:        ethers.parseEther(String(m.faceValueUSD)),
      discountRateBps:     BigInt(m.discountRateBps),
      issuanceDate:        now,
      dueDate:             now + dueDays,
      invoiceDocumentHash: ethers.ZeroHash,
      currency:            m.currency,
      lastUpdated:         now,
    };

  } else if (template === "carbon-credit") {
    const m = await inquirer.prompt([
      { type: "list",   name: "creditType",          message: "Credit type:",               choices: ["REDD+", "VCS", "Gold Standard", "GS4GG", "CDM"], default: "VCS" },
      { type: "input",  name: "verificationBodyRef", message: "Verification body ref:",     default: "VERRA-001" },
      { type: "number", name: "vintageYear",         message: "Vintage year:",              default: 2025 },
      { type: "number", name: "quantityCO2e",        message: "Quantity CO2e (tonnes):",    default: 1000 },
      { type: "input",  name: "projectLocation",     message: "Project location:",          default: "Congo Basin, DRC" },
      { type: "list",   name: "projectType",         message: "Project type:",              choices: ["Forestry", "Agriculture", "Energy", "Waste"], default: "Forestry" },
    ]);
    metadata = {
      creditType:          m.creditType,
      verificationBodyRef: m.verificationBodyRef,
      vintageYear:         BigInt(m.vintageYear),
      quantityCO2e:        ethers.parseEther(String(m.quantityCO2e)),
      projectLocation:     m.projectLocation,
      projectType:         m.projectType,
      verificationDocHash: ethers.ZeroHash,
      lastUpdated:         now,
    };

  } else {
    // mining-rights
    const m = await inquirer.prompt([
      { type: "input",  name: "licenseNumber",    message: "License number:",                 default: "LIC-001" },
      { type: "list",   name: "mineralType",      message: "Mineral type:",                   choices: ["Gold", "Coltan", "Copper", "Diamond", "Coal", "Lithium"], default: "Gold" },
      { type: "input",  name: "concessionArea",   message: "Concession area description:",   default: "North Block A" },
      { type: "number", name: "areaHectares",     message: "Area (hectares):",               default: 500 },
      { type: "number", name: "licenseExpiryDays",message: "License expiry (days from now):", default: 365 },
      { type: "input",  name: "issuingAuthority", message: "Issuing authority:",             default: "Ministry of Mines" },
      { type: "number", name: "royaltyRateBps",   message: "Royalty rate (bps, e.g. 300 = 3%):", default: 300 },
    ]);
    const expiryDays = BigInt(m.licenseExpiryDays) * BigInt(60 * 60 * 24);
    metadata = {
      licenseNumber:       m.licenseNumber,
      mineralType:         m.mineralType,
      concessionArea:      m.concessionArea,
      areaHectares:        BigInt(m.areaHectares),
      licenseExpiry:       now + expiryDays,
      issuingAuthority:    m.issuingAuthority,
      licenseDocumentHash: ethers.ZeroHash,
      royaltyRateBps:      BigInt(m.royaltyRateBps),
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
    const factory = new TokenFactory(buildAnkaraChainConfig(config));

    const deployOpts = {
      name:        details.name,
      symbol:      details.symbol,
      assetId:     details.assetId,
      countryCode: details.countryCode,
      metadata,
    };

    let result;
    switch (template) {
      case "farmland":      result = await factory.deployFarmland(deployOpts as any);      break;
      case "commodity":     result = await factory.deployCommodity(deployOpts as any);     break;
      case "real-estate":   result = await factory.deployRealEstate(deployOpts as any);   break;
      case "invoice":       result = await factory.deployInvoice(deployOpts as any);       break;
      case "carbon-credit": result = await factory.deployCarbonCredit(deployOpts as any); break;
      case "mining-rights": result = await factory.deployMiningRights(deployOpts as any); break;
      default: throw new Error(`Unknown template: ${template}`);
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
