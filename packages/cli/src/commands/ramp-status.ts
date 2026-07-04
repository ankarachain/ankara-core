import inquirer from "inquirer";
import { ethers } from "ethers";
import { RAMP_SETTLEMENT_ABI, RampSettlementStatus } from "@ankarachain/sdk";
import { logger } from "../utils/logger.js";
import { readConfig, getRpcUrl } from "../utils/config.js";

const STATUS_LABEL: Record<number, string> = {
  [RampSettlementStatus.NONE]:     "NONE",
  [RampSettlementStatus.PENDING]:  "PENDING",
  [RampSettlementStatus.SETTLED]:  "SETTLED",
  [RampSettlementStatus.REFUNDED]: "REFUNDED",
  [RampSettlementStatus.RECORDED]: "RECORDED",
};

export async function rampStatusCommand(opts: { settlement?: string }) {
  logger.blank();
  console.log("  📋  Ramp Settlement Status");
  logger.divider();
  logger.blank();

  const config = readConfig();

  let settlementAddress = opts.settlement;
  if (!settlementAddress) {
    const ans = await inquirer.prompt([
      { type: "input", name: "settlement", message: "RampSettlement address:" },
    ]);
    settlementAddress = ans.settlement;
  }

  const { reference } = await inquirer.prompt([
    { type: "input", name: "reference", message: "Reference string:" },
  ]);

  try {
    const rpcUrl   = getRpcUrl(config);
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const contract = new ethers.Contract(settlementAddress!, RAMP_SETTLEMENT_ABI, provider);

    const referenceId = ethers.keccak256(ethers.toUtf8Bytes(reference));
    const [treasury, offRamp, onRamp] = await Promise.all([
      contract.treasury(),
      contract.getOffRamp(referenceId),
      contract.getOnRamp(referenceId),
    ]);

    logger.blank();
    logger.divider();
    logger.info(`Treasury : ${treasury}`);
    logger.blank();

    if (Number(offRamp.status) !== RampSettlementStatus.NONE) {
      logger.info("Off-Ramp Deposit:");
      logger.info(`  Depositor : ${offRamp.depositor}`);
      logger.info(`  Token     : ${offRamp.token}`);
      logger.info(`  Amount    : ${ethers.formatEther(offRamp.amount)}`);
      logger.info(`  Status    : ${STATUS_LABEL[Number(offRamp.status)]}`);
    }

    if (Number(onRamp.status) !== RampSettlementStatus.NONE) {
      logger.info("On-Ramp Record:");
      logger.info(`  Recipient : ${onRamp.recipient}`);
      logger.info(`  Token     : ${onRamp.token}`);
      logger.info(`  Amount    : ${ethers.formatEther(onRamp.amount)}`);
      logger.info(`  Status    : ${STATUS_LABEL[Number(onRamp.status)]}`);
    }

    if (Number(offRamp.status) === RampSettlementStatus.NONE && Number(onRamp.status) === RampSettlementStatus.NONE) {
      logger.info("No off-ramp deposit or on-ramp record found for this reference.");
    }

    logger.divider();
    logger.blank();
  } catch (err: any) {
    logger.error(err.message ?? String(err));
    process.exit(1);
  }
}
