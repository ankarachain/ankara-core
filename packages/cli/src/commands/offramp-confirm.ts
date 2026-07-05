import ora from "ora";
import inquirer from "inquirer";
import { RampManager, ManualRampProvider } from "@ankarachain/sdk";
import { logger } from "../utils/logger.js";
import { readConfig } from "../utils/config.js";
import { buildAdapter } from "../utils/adapter.js";

export async function offrampConfirmCommand() {
  logger.blank();
  console.log("  ✅  Confirm Off-Ramp Settlement (releases custody to treasury)");
  logger.divider();
  logger.blank();

  const config = readConfig();

  const { settlement, reference } = await inquirer.prompt([
    { type: "input", name: "settlement", message: "RampSettlement contract address:" },
    { type: "input", name: "reference",  message: "Reference string (from offramp-initiate):" },
  ]);

  const spinner = ora("Confirming off-ramp settlement…").start();

  try {
    const adapter = buildAdapter(config);
    const ramp    = new RampManager(new ManualRampProvider(), adapter, { settlementAddress: settlement });
    const txHash  = await ramp.confirmOffRampSettlement(reference);

    spinner.succeed("Off-ramp settled — custodied tokens released to treasury");
    logger.info(`Tx hash: ${txHash}`);
  } catch (err: any) {
    spinner.fail("Confirmation failed");
    logger.error(err.message ?? String(err));
    process.exit(1);
  }
}
