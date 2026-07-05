import ora from "ora";
import inquirer from "inquirer";
import { ethers } from "ethers";
import { logger } from "../utils/logger.js";
import { readConfig, getPrivateKey, getRpcUrl, isStellarNetwork } from "../utils/config.js";
import { buildAdapter } from "../utils/adapter.js";

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
    // EVM needs an explicit ERC-20 approval before the vault can pull the
    // funds; Stellar's `deposit()` authorizes the nested SEP-41 transfer
    // within the same call, so there's nothing to pre-approve there.
    if (!isStellarNetwork(config.network)) {
      const privateKey = getPrivateKey();
      const rpcUrl      = getRpcUrl(config);
      const provider    = new ethers.JsonRpcProvider(rpcUrl);
      const wallet      = new ethers.Wallet(privateKey, provider);

      const token = new ethers.Contract(details.token, ERC20_APPROVE_ABI, wallet);
      const approveTx = await token.approve(details.vault, amountWei);
      await approveTx.wait();
    }

    spinner.text = "Depositing into vault…";

    const adapter = buildAdapter(config);
    const txHash  = await adapter.poolDeposit(details.vault, details.token, amountWei);

    spinner.succeed(`Deposited ${details.amount} tokens into vault`);
    logger.info(`Tx hash: ${txHash}`);
  } catch (err: any) {
    spinner.fail("Deposit failed");
    logger.error(err.message ?? String(err));
    process.exit(1);
  }
}
