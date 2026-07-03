import ora from "ora";
import inquirer from "inquirer";
import { ethers } from "ethers";
import { EVMAdapter, EscrowManager } from "@ankarachain/sdk";
import { logger } from "../utils/logger.js";
import { readConfig, getPrivateKey, getRpcUrl } from "../utils/config.js";

export async function escrowDisputeCommand() {
  logger.blank();
  console.log("  ⚠️  Raise Milestone Dispute");
  logger.divider();
  logger.blank();

  const config = readConfig();

  const { escrow, milestoneId } = await inquirer.prompt([
    { type: "input",  name: "escrow",      message: "Escrow address:" },
    { type: "number", name: "milestoneId", message: "Milestone ID (0-indexed):", default: 0 },
  ]);

  const spinner = ora("Raising dispute…").start();

  try {
    const privateKey = getPrivateKey();
    const rpcUrl     = getRpcUrl(config);
    const provider   = new ethers.JsonRpcProvider(rpcUrl);
    const wallet     = new ethers.Wallet(privateKey, provider);

    const adapter = new EVMAdapter(config.network, provider, wallet);
    const manager = new EscrowManager(adapter, escrow);
    const txHash  = await manager.raiseDispute(milestoneId);

    spinner.succeed(`Dispute raised on milestone ${milestoneId}`);
    logger.info(`Tx hash: ${txHash}`);
    logger.info("The configured arbiter can now run \"ankara escrow-resolve\".");
  } catch (err: any) {
    spinner.fail("Failed to raise dispute");
    logger.error(err.message ?? String(err));
    process.exit(1);
  }
}
