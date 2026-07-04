import ora from "ora";
import inquirer from "inquirer";
import { ethers } from "ethers";
import { EVMAdapter, RampManager, ManualRampProvider } from "@ankarachain/sdk";
import { logger } from "../utils/logger.js";
import { readConfig, getPrivateKey, getRpcUrl } from "../utils/config.js";

export async function offrampRefundCommand() {
  logger.blank();
  console.log("  ↩️  Refund Off-Ramp Deposit (payout failed)");
  logger.divider();
  logger.blank();

  const config = readConfig();

  const { settlement, reference } = await inquirer.prompt([
    { type: "input", name: "settlement", message: "RampSettlement contract address:" },
    { type: "input", name: "reference",  message: "Reference string (from offramp-initiate):" },
  ]);

  const spinner = ora("Refunding off-ramp deposit…").start();

  try {
    const privateKey = getPrivateKey();
    const rpcUrl     = getRpcUrl(config);
    const provider   = new ethers.JsonRpcProvider(rpcUrl);
    const wallet     = new ethers.Wallet(privateKey, provider);

    const adapter = new EVMAdapter(config.network, provider, wallet);
    const ramp    = new RampManager(new ManualRampProvider(), adapter, { settlementAddress: settlement });
    const txHash  = await ramp.refundOffRamp(reference);

    spinner.succeed("Custodied tokens returned to the original depositor");
    logger.info(`Tx hash: ${txHash}`);
  } catch (err: any) {
    spinner.fail("Refund failed");
    logger.error(err.message ?? String(err));
    process.exit(1);
  }
}
