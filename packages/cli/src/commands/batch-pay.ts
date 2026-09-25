import { readFileSync } from "fs";
import ora from "ora";
import inquirer from "inquirer";
import { BatchDisburser, StellarAdapter, parseDisbursementCsv } from "@ankarachain/sdk";
import { logger } from "../utils/logger.js";
import { readConfig, isStellarNetwork } from "../utils/config.js";
import { buildAdapter } from "../utils/adapter.js";

export interface BatchPayOptions {
  contract?: string;
  token?: string;
  file?: string;
  reference?: string;
  yes?: boolean;
}

/**
 * `ankara batch-pay` — pays every `recipient,amount` row of a CSV from the
 * configured Stellar account through a deployed `batch-disburser`, 100
 * recipients per transaction. Flags skip the matching prompts, so it can run
 * unattended (e.g. a monthly payroll cron with `--yes`).
 */
export async function batchPayCommand(opts: BatchPayOptions = {}) {
  logger.blank();
  console.log("  💸  Batch Disbursement (payroll / distributions)");
  logger.divider();
  logger.blank();

  const config = readConfig();
  if (!isStellarNetwork(config.network)) {
    logger.error("batch-pay uses the Soroban batch-disburser contract — set a Stellar network in ankara.config.json.");
    process.exit(1);
  }

  const answers = await inquirer.prompt([
    { type: "input", name: "contract",  message: "BatchDisburser contract address:", when: !opts.contract },
    { type: "input", name: "token",     message: "Token contract address (e.g. USDC SAC):", when: !opts.token },
    { type: "input", name: "file",      message: "CSV file (recipient,amount per line):", default: "payouts.csv", when: !opts.file },
    { type: "input", name: "reference", message: "Reference (shown in the on-chain event):", default: "", when: opts.reference === undefined },
  ]);
  const contract  = opts.contract  ?? answers.contract;
  const token     = opts.token     ?? answers.token;
  const file      = opts.file      ?? answers.file;
  const reference = opts.reference ?? answers.reference ?? "";

  let payments;
  try {
    payments = parseDisbursementCsv(readFileSync(file, "utf-8"));
  } catch (err: any) {
    logger.error(`Could not read ${file}: ${err.message ?? String(err)}`);
    process.exit(1);
  }
  if (payments.length === 0) {
    logger.error(`${file} contains no payments.`);
    process.exit(1);
  }

  const total = payments.reduce((sum, p) => sum + p.amount, 0n);
  const batches = Math.ceil(payments.length / BatchDisburser.MAX_PAYMENTS);
  logger.info(`${payments.length} recipients, total ${total} (smallest units), ${batches} transaction(s).`);

  if (!opts.yes) {
    const { confirm } = await inquirer.prompt([
      { type: "confirm", name: "confirm", message: "Send these payments?", default: false },
    ]);
    if (!confirm) {
      logger.info("Cancelled — nothing was sent.");
      return;
    }
  }

  const spinner = ora(`Disbursing to ${payments.length} recipients…`).start();
  try {
    const adapter = buildAdapter(config) as StellarAdapter;
    const disburser = new BatchDisburser(adapter, contract);
    const result = await disburser.disburse(token, payments, reference);
    spinner.succeed(`Paid ${payments.length} recipients (${result.totalPaid} total) in ${result.batches} transaction(s)`);
    result.txHashes.forEach((h, i) => logger.info(`Batch ${i + 1} tx: ${h}`));
  } catch (err: any) {
    spinner.fail("Disbursement failed — the failing batch was reverted in full; earlier batches (if any) were paid");
    logger.error(err.message ?? String(err));
    process.exit(1);
  }
}
