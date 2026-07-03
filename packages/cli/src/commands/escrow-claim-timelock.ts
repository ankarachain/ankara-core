import ora from "ora";
import inquirer from "inquirer";
import { ethers } from "ethers";
import { EVMAdapter, EscrowManager } from "@ankarachain/sdk";
import { logger } from "../utils/logger.js";
import { readConfig, getPrivateKey, getRpcUrl } from "../utils/config.js";

export async function escrowClaimTimelockCommand() {
  logger.blank();
  console.log("  ⏰  Force-Release via Timelock");
  logger.divider();
  logger.blank();
  logger.info("Only works if the milestone was marked delivered and the timelock has elapsed with no dispute raised.");
  logger.blank();

  const config = readConfig();

  const { escrow, milestoneId } = await inquirer.prompt([
    { type: "input",  name: "escrow",      message: "Escrow address:" },
    { type: "number", name: "milestoneId", message: "Milestone ID (0-indexed):", default: 0 },
  ]);

  const spinner = ora("Claiming timelock release…").start();

  try {
    const privateKey = getPrivateKey();
    const rpcUrl     = getRpcUrl(config);
    const provider   = new ethers.JsonRpcProvider(rpcUrl);
    const wallet     = new ethers.Wallet(privateKey, provider);

    const adapter = new EVMAdapter(config.network, provider, wallet);
    const manager = new EscrowManager(adapter, escrow);
    const txHash  = await manager.claimTimelockRelease(milestoneId);

    spinner.succeed(`Milestone ${milestoneId} released via timelock`);
    logger.info(`Tx hash: ${txHash}`);
  } catch (err: any) {
    spinner.fail("Timelock claim failed");
    logger.error(err.message ?? String(err));
    process.exit(1);
  }
}
