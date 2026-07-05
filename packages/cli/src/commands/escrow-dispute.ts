import ora from "ora";
import inquirer from "inquirer";
import { EscrowManager } from "@ankarachain/sdk";
import { logger } from "../utils/logger.js";
import { readConfig } from "../utils/config.js";
import { buildAdapter } from "../utils/adapter.js";

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
    const adapter = buildAdapter(config);
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
