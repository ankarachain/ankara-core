import ora from "ora";
import inquirer from "inquirer";
import { EscrowManager } from "@ankarachain/sdk";
import { logger } from "../utils/logger.js";
import { readConfig } from "../utils/config.js";
import { buildAdapter } from "../utils/adapter.js";

export async function escrowApproveCommand() {
  logger.blank();
  console.log("  ✅  Approve Milestone (releases funds)");
  logger.divider();
  logger.blank();

  const config = readConfig();

  const { escrow, milestoneId } = await inquirer.prompt([
    { type: "input",  name: "escrow",      message: "Escrow address:" },
    { type: "number", name: "milestoneId", message: "Milestone ID (0-indexed):", default: 0 },
  ]);

  const spinner = ora("Approving milestone…").start();

  try {
    const adapter = buildAdapter(config);
    const manager = new EscrowManager(adapter, escrow);
    const txHash  = await manager.approveMilestone(milestoneId);

    spinner.succeed(`Milestone ${milestoneId} approved — funds released to payee`);
    logger.info(`Tx hash: ${txHash}`);
  } catch (err: any) {
    spinner.fail("Approval failed");
    logger.error(err.message ?? String(err));
    process.exit(1);
  }
}
