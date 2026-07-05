import ora from "ora";
import inquirer from "inquirer";
import { ethers } from "ethers";
import { logger } from "../utils/logger.js";
import { readConfig } from "../utils/config.js";
import { buildAdapter } from "../utils/adapter.js";

export async function withdrawCommand() {
  logger.blank();
  console.log("  🏧  Withdraw from PoolVault");
  logger.divider();
  logger.blank();

  const config = readConfig();

  const details = await inquirer.prompt([
    { type: "input", name: "vault",  message: "PoolVault address:" },
    { type: "input", name: "amount", message: "Pool tokens to burn (e.g. 50):", default: "50" },
  ]);

  const amountWei = ethers.parseEther(details.amount);

  const spinner = ora(`Withdrawing ${details.amount} pool tokens…`).start();
  try {
    const adapter = buildAdapter(config);
    const txHash  = await adapter.poolWithdraw(details.vault, amountWei);

    spinner.succeed(`Withdrew ${details.amount} pool tokens`);
    logger.info(`Tx hash: ${txHash}`);
  } catch (err: any) {
    spinner.fail("Withdrawal failed");
    logger.error(err.message ?? String(err));
    process.exit(1);
  }
}
