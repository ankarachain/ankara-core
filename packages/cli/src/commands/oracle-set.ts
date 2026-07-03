import ora from "ora";
import inquirer from "inquirer";
import { ethers } from "ethers";
import { MANUAL_ORACLE_ABI } from "@ankarachain/sdk";
import { logger } from "../utils/logger.js";
import { readConfig, getPrivateKey, getRpcUrl } from "../utils/config.js";

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
    const privateKey = getPrivateKey();
    const rpcUrl     = getRpcUrl(config);
    const provider   = new ethers.JsonRpcProvider(rpcUrl);
    const wallet     = new ethers.Wallet(privateKey, provider);

    const oracle  = new ethers.Contract(details.oracle, MANUAL_ORACLE_ABI, wallet);
    const tx      = await oracle.setPrice(details.token, priceWei);
    const receipt = await tx.wait();

    spinner.succeed(`Price set: $${details.price} for ${details.token}`);
    logger.info(`Tx hash: ${receipt.hash}`);
  } catch (err: any) {
    spinner.fail("Failed to set price");
    logger.error(err.message ?? String(err));
    process.exit(1);
  }
}
