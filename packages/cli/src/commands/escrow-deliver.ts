import ora from "ora";
import inquirer from "inquirer";
import { EscrowManager } from "@ankarachain/sdk";
import { logger } from "../utils/logger.js";
import { readConfig } from "../utils/config.js";
import { buildAdapter } from "../utils/adapter.js";

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
    const adapter = buildAdapter(config);
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
