import ora from "ora";
import inquirer from "inquirer";
import { ethers } from "ethers";
import { POOL_VAULT_ABI } from "@ankarachain/sdk";
import { logger } from "../utils/logger.js";
import { readConfig, getPrivateKey, getRpcUrl } from "../utils/config.js";

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
    const privateKey = getPrivateKey();
    const rpcUrl     = getRpcUrl(config);
    const provider   = new ethers.JsonRpcProvider(rpcUrl);
    const wallet     = new ethers.Wallet(privateKey, provider);

    const vault   = new ethers.Contract(details.vault, POOL_VAULT_ABI, wallet);
    const tx      = await vault.withdraw(amountWei);
    const receipt = await tx.wait();

    spinner.succeed(`Withdrew ${details.amount} pool tokens`);
    logger.info(`Tx hash: ${receipt.hash}`);
  } catch (err: any) {
    spinner.fail("Withdrawal failed");
    logger.error(err.message ?? String(err));
    process.exit(1);
  }
}
