import ora from "ora";
import inquirer from "inquirer";
import { ethers } from "ethers";
import { EVMAdapter, EscrowManager } from "@ankarachain/sdk";
import { logger } from "../utils/logger.js";
import { readConfig, getPrivateKey, getRpcUrl } from "../utils/config.js";

export async function escrowDeliverCommand() {
  logger.blank();
  console.log("  📦  Mark Milestone Delivered");
  logger.divider();
  logger.blank();

  const config = readConfig();

  const { escrow, milestoneId } = await inquirer.prompt([
    { type: "input",  name: "escrow",      message: "Escrow address:" },
    { type: "number", name: "milestoneId", message: "Milestone ID (0-indexed):", default: 0 },
  ]);

  const spinner = ora("Marking milestone delivered…").start();

  try {
    const privateKey = getPrivateKey();
    const rpcUrl     = getRpcUrl(config);
    const provider   = new ethers.JsonRpcProvider(rpcUrl);
    const wallet     = new ethers.Wallet(privateKey, provider);

    const adapter = new EVMAdapter(config.network, provider, wallet);
    const manager = new EscrowManager(adapter, escrow);
    const txHash  = await manager.markDelivered(milestoneId);

    spinner.succeed(`Milestone ${milestoneId} marked delivered`);
    logger.info(`Tx hash: ${txHash}`);
    logger.info("The payer can now run \"ankara escrow-approve\" to release funds.");
  } catch (err: any) {
    spinner.fail("Failed to mark delivered");
    logger.error(err.message ?? String(err));
    process.exit(1);
  }
}
