import ora from "ora";
import inquirer from "inquirer";
import { EscrowManager } from "@ankarachain/sdk";
import { logger } from "../utils/logger.js";
import { readConfig } from "../utils/config.js";
import { buildAdapter } from "../utils/adapter.js";

export async function escrowResolveCommand() {
  logger.blank();
  console.log("  ⚖️  Resolve Milestone Dispute (arbiter only)");
  logger.divider();
  logger.blank();

  const config = readConfig();

  const { escrow, milestoneId, decision } = await inquirer.prompt([
    { type: "input",  name: "escrow",      message: "Escrow address:" },
    { type: "number", name: "milestoneId", message: "Milestone ID (0-indexed):", default: 0 },
    {
      type: "list", name: "decision", message: "Resolution:",
      choices: [
        { name: "Release funds to payee", value: true },
        { name: "Refund funds to payer",  value: false },
      ],
    },
  ]);

  const spinner = ora("Resolving dispute…").start();

  try {
    const adapter = buildAdapter(config);
    const manager = new EscrowManager(adapter, escrow);
    const txHash  = await manager.resolveDispute(milestoneId, decision);

    spinner.succeed(`Milestone ${milestoneId} resolved — ${decision ? "released to payee" : "refunded to payer"}`);
    logger.info(`Tx hash: ${txHash}`);
  } catch (err: any) {
    spinner.fail("Resolution failed");
    logger.error(err.message ?? String(err));
    process.exit(1);
  }
}
