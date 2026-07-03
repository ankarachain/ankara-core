import ora from "ora";
import inquirer from "inquirer";
import { ethers } from "ethers";
import { COMMODITY_BATCH_TOKEN_ABI } from "@ankarachain/sdk";
import { logger } from "../utils/logger.js";
import { readConfig, getPrivateKey, getRpcUrl } from "../utils/config.js";

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
    const privateKey = getPrivateKey();
    const rpcUrl     = getRpcUrl(config);
    const provider   = new ethers.JsonRpcProvider(rpcUrl);
    const wallet     = new ethers.Wallet(privateKey, provider);

    const contract = new ethers.Contract(
      details.contract,
      COMMODITY_BATCH_TOKEN_ABI,
      wallet
    );

    const tx = await contract.mint(
      details.to,
      BigInt(details.batchId),
      BigInt(details.amount),
      "0x"
    );
    const receipt = await tx.wait();

    spinner.succeed(`Minted ${details.amount} tokens (batch ${details.batchId}) to ${details.to}`);
    logger.info(`Tx hash: ${receipt.hash}`);
  } catch (err: any) {
    spinner.fail("Mint failed");
    logger.error(err.message ?? String(err));
    process.exit(1);
  }
}
