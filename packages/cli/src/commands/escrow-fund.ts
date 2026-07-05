import ora from "ora";
import inquirer from "inquirer";
import { ethers } from "ethers";
import { EscrowManager, MILESTONE_ESCROW_ABI } from "@ankarachain/sdk";
import { logger } from "../utils/logger.js";
import { readConfig, getPrivateKey, getRpcUrl, isStellarNetwork } from "../utils/config.js";
import { buildAdapter } from "../utils/adapter.js";

const ERC20_APPROVE_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
] as const;

export async function escrowFundCommand() {
  logger.blank();
  console.log("  💰  Fund Milestone Escrow");
  logger.divider();
  logger.blank();

  const config = readConfig();

  const { escrow } = await inquirer.prompt([
    { type: "input", name: "escrow", message: "Escrow address:" },
  ]);

  const spinner = ora("Approving and funding…").start();

  try {
    const adapter = buildAdapter(config);
    const manager = new EscrowManager(adapter, escrow);
    const totalAmount = await manager.getTotalAmount();

    // EVM needs an explicit ERC-20 approval before the escrow can pull the
    // funds; Stellar's `fund()` authorizes the nested SEP-41 transfer within
    // the same call, so there's nothing to pre-approve there.
    if (!isStellarNetwork(config.network)) {
      const privateKey = getPrivateKey();
      const rpcUrl      = getRpcUrl(config);
      const provider    = new ethers.JsonRpcProvider(rpcUrl);
      const wallet      = new ethers.Wallet(privateKey, provider);

      const escrowRead = new ethers.Contract(escrow, MILESTONE_ESCROW_ABI, provider);
      const tokenAddress: string = await escrowRead.token();

      const token = new ethers.Contract(tokenAddress, ERC20_APPROVE_ABI, wallet);
      const approveTx = await token.approve(escrow, totalAmount);
      await approveTx.wait();
    }

    spinner.text = "Depositing into escrow…";

    const txHash = await manager.fund();

    spinner.succeed(`Escrow funded with ${ethers.formatEther(totalAmount)} tokens`);
    logger.info(`Tx hash: ${txHash}`);
  } catch (err: any) {
    spinner.fail("Funding failed");
    logger.error(err.message ?? String(err));
    process.exit(1);
  }
}
