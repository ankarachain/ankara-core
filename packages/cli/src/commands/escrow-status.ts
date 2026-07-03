import inquirer from "inquirer";
import { ethers } from "ethers";
import { MILESTONE_ESCROW_ABI, MilestoneStatus } from "@ankarachain/sdk";
import { logger } from "../utils/logger.js";
import { readConfig, getRpcUrl } from "../utils/config.js";

const STATUS_LABEL: Record<number, string> = {
  [MilestoneStatus.PENDING]:   "PENDING",
  [MilestoneStatus.DELIVERED]: "DELIVERED",
  [MilestoneStatus.DISPUTED]:  "DISPUTED",
  [MilestoneStatus.RELEASED]:  "RELEASED",
  [MilestoneStatus.REFUNDED]:  "REFUNDED",
};

export async function escrowStatusCommand(opts: { escrow?: string }) {
  logger.blank();
  console.log("  📋  Milestone Escrow Status");
  logger.divider();
  logger.blank();

  const config = readConfig();

  let escrowAddress = opts.escrow;
  if (!escrowAddress) {
    const ans = await inquirer.prompt([
      { type: "input", name: "escrow", message: "Escrow address:" },
    ]);
    escrowAddress = ans.escrow;
  }

  try {
    const rpcUrl   = getRpcUrl(config);
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const escrow   = new ethers.Contract(escrowAddress!, MILESTONE_ESCROW_ABI, provider);

    const [payer, payee, arbiter, token, totalAmount, funded, cancelled, remainingBalance, milestoneCount] =
      await Promise.all([
        escrow.payer(),
        escrow.payee(),
        escrow.arbiter(),
        escrow.token(),
        escrow.totalAmount(),
        escrow.funded(),
        escrow.cancelled(),
        escrow.remainingBalance(),
        escrow.milestoneCount(),
      ]);

    logger.blank();
    logger.divider();
    logger.info(`Payer            : ${payer}`);
    logger.info(`Payee            : ${payee}`);
    logger.info(`Arbiter          : ${arbiter === ethers.ZeroAddress ? "none" : arbiter}`);
    logger.info(`Token            : ${token}`);
    logger.info(`Total Amount     : ${ethers.formatEther(totalAmount)}`);
    logger.info(`Funded           : ${funded}`);
    logger.info(`Cancelled        : ${cancelled}`);
    logger.info(`Remaining Balance: ${ethers.formatEther(remainingBalance)}`);
    logger.blank();
    logger.info(`Milestones (${milestoneCount}):`);

    for (let i = 0; i < Number(milestoneCount); i++) {
      const m = await escrow.getMilestone(i);
      const status = STATUS_LABEL[Number(m.status)] ?? "UNKNOWN";
      const delivered = m.deliveredAt > 0n
        ? new Date(Number(m.deliveredAt) * 1000).toISOString()
        : "—";
      logger.info(`  [${i}] ${ethers.formatEther(m.amount)} — ${status} (delivered: ${delivered})`);
    }
    logger.divider();
    logger.blank();
  } catch (err: any) {
    logger.error(err.message ?? String(err));
    process.exit(1);
  }
}
