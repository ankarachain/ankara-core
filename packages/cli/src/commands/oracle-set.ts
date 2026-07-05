import ora from "ora";
import inquirer from "inquirer";
import { ethers } from "ethers";
import { logger } from "../utils/logger.js";
import { readConfig } from "../utils/config.js";
import { buildAdapter } from "../utils/adapter.js";

export async function oracleSetCommand() {
  logger.blank();
  console.log("  🔮  Set Oracle Price");
  logger.divider();
  logger.blank();

  const config = readConfig();

  const details = await inquirer.prompt([
    { type: "input", name: "oracle", message: "ManualOracle address:" },
    { type: "input", name: "token",  message: "Token address to price:" },
    { type: "input", name: "price",  message: "Price in USD (e.g. 1.50):", default: "1.00" },
  ]);

  const priceWei = ethers.parseEther(details.price);

  const spinner = ora(`Setting price $${details.price} for ${details.token}…`).start();
  try {
    const adapter = buildAdapter(config);
    const txHash  = await adapter.oracleSetPrice(details.oracle, details.token, priceWei);

    spinner.succeed(`Price set: $${details.price} for ${details.token}`);
    logger.info(`Tx hash: ${txHash}`);
  } catch (err: any) {
    spinner.fail("Failed to set price");
    logger.error(err.message ?? String(err));
    process.exit(1);
  }
}
