import ora from "ora";
import inquirer from "inquirer";
import { ethers } from "ethers";
import { POOL_VAULT_ABI } from "@ankarachain/sdk";
import { logger } from "../utils/logger.js";
import { readConfig, getPrivateKey, getRpcUrl } from "../utils/config.js";

const ERC20_APPROVE_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
] as const;

export async function depositCommand() {
  logger.blank();
  console.log("  💰  Deposit into PoolVault");
  logger.divider();
  logger.blank();

  const config = readConfig();

  const details = await inquirer.prompt([
    { type: "input", name: "vault",  message: "PoolVault address:" },
    { type: "input", name: "token",  message: "ERC-20 token address to deposit:" },
    { type: "input", name: "amount", message: "Amount (in token units, e.g. 100):", default: "100" },
  ]);

  const amountWei = ethers.parseEther(details.amount);

  const spinner = ora("Approving token spend…").start();
  try {
    const privateKey = getPrivateKey();
    const rpcUrl     = getRpcUrl(config);
    const provider   = new ethers.JsonRpcProvider(rpcUrl);
    const wallet     = new ethers.Wallet(privateKey, provider);

    const token = new ethers.Contract(details.token, ERC20_APPROVE_ABI, wallet);
    const approveTx = await token.approve(details.vault, amountWei);
    await approveTx.wait();

    spinner.text = "Depositing into vault…";

    const vault = new ethers.Contract(details.vault, POOL_VAULT_ABI, wallet);
    const tx    = await vault.deposit(details.token, amountWei);
    const receipt = await tx.wait();

    spinner.succeed(`Deposited ${details.amount} tokens into vault`);
    logger.info(`Tx hash: ${receipt.hash}`);
  } catch (err: any) {
    spinner.fail("Deposit failed");
    logger.error(err.message ?? String(err));
    process.exit(1);
  }
}
