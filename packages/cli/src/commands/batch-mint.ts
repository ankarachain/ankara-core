import ora from "ora";
import inquirer from "inquirer";
import { logger } from "../utils/logger.js";
import { readConfig } from "../utils/config.js";
import { buildAdapter } from "../utils/adapter.js";

export async function batchMintCommand() {
  logger.blank();
  console.log("  🪙  Mint Commodity Batch Tokens (ERC-1155)");
  logger.divider();
  logger.blank();

  const config = readConfig();

  const details = await inquirer.prompt([
    { type: "input", name: "contract", message: "CommodityBatchToken address:" },
    { type: "input", name: "batchId",  message: "Batch ID:",        default: "1" },
    { type: "input", name: "to",       message: "Recipient address:" },
    { type: "input", name: "amount",   message: "Amount to mint:",   default: "100" },
  ]);

  const spinner = ora(`Minting ${details.amount} tokens for batch ${details.batchId}…`).start();
  try {
    const adapter = buildAdapter(config);
    const txHash  = await adapter.batchMint(
      details.contract,
      BigInt(details.batchId),
      details.to,
      BigInt(details.amount)
    );

    spinner.succeed(`Minted ${details.amount} tokens (batch ${details.batchId}) to ${details.to}`);
    logger.info(`Tx hash: ${txHash}`);
  } catch (err: any) {
    spinner.fail("Mint failed");
    logger.error(err.message ?? String(err));
    process.exit(1);
  }
}
