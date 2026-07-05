import ora from "ora";
import inquirer from "inquirer";
import { ethers } from "ethers";
import { logger } from "../utils/logger.js";
import { readConfig } from "../utils/config.js";
import { buildAdapter } from "../utils/adapter.js";

export async function registerBatchCommand() {
  logger.blank();
  console.log("  📋  Register Commodity Batch");
  logger.divider();
  logger.blank();

  const config = readConfig();

  const details = await inquirer.prompt([
    { type: "input",  name: "contract",           message: "CommodityBatchToken address:" },
    { type: "input",  name: "batchId",            message: "Batch ID (number):",              default: "1" },
    { type: "input",  name: "commodityType",      message: "Commodity type:",                 default: "cocoa" },
    { type: "input",  name: "quantityKg",         message: "Quantity (kg):",                  default: "1000" },
    { type: "input",  name: "gradeClassification",message: "Grade classification:",            default: "Grade A" },
    { type: "input",  name: "harvestSeason",      message: "Harvest season:",                 default: "2025-Q1" },
    { type: "input",  name: "originCountry",      message: "Origin country code:",            default: "NG" },
    { type: "input",  name: "valuationUSD",       message: "Valuation USD (in ether units):", default: "10000" },
    { type: "input",  name: "expiryDate",         message: "Expiry unix timestamp:",          default: String(Math.floor(Date.now() / 1000) + 365 * 86400) },
  ]);

  const spinner = ora("Registering batch…").start();
  try {
    const adapter = buildAdapter(config);

    const meta = {
      commodityType:       details.commodityType,
      quantityKg:          BigInt(details.quantityKg),
      gradeClassification: details.gradeClassification,
      depositDate:         BigInt(Math.floor(Date.now() / 1000)),
      expiryDate:          BigInt(details.expiryDate),
      inspectionReportHash: ethers.ZeroHash,
      valuationUSD:        ethers.parseEther(details.valuationUSD),
      harvestSeason:       details.harvestSeason,
      originCountry:       details.originCountry,
    };

    const txHash = await adapter.batchRegister(details.contract, BigInt(details.batchId), meta);

    spinner.succeed(`Batch ${details.batchId} registered`);
    logger.info(`Tx hash: ${txHash}`);
  } catch (err: any) {
    spinner.fail("Registration failed");
    logger.error(err.message ?? String(err));
    process.exit(1);
  }
}
