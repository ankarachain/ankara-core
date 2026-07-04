import inquirer from "inquirer";
import { ManualRampProvider } from "@ankarachain/sdk";
import { logger } from "../utils/logger.js";

export async function onrampInitiateCommand() {
  logger.blank();
  console.log("  🟢  Initiate On-Ramp (fiat → tokens)");
  logger.divider();
  logger.info("Uses ManualRampProvider — a reference implementation for dev/testing.");
  logger.blank();

  const details = await inquirer.prompt([
    { type: "input", name: "fiatAmount",       message: "Fiat amount:", default: "1500" },
    { type: "input", name: "fiatCurrency",     message: "Fiat currency (e.g. NGN, KES, GHS):", default: "NGN" },
    { type: "input", name: "tokenSymbol",      message: "Token symbol:", default: "mUSD" },
    { type: "input", name: "recipientAddress", message: "Recipient wallet address:" },
    { type: "input", name: "countryCode",      message: "Country code (ISO 3166-1 alpha-2):", default: "NG" },
  ]);

  try {
    const provider = new ManualRampProvider();
    const session = await provider.initiateOnRamp(details);

    logger.blank();
    logger.divider();
    logger.info(`Session ID   : ${session.sessionId}`);
    logger.info(`Status       : ${session.status}`);
    logger.info(`Payment URL  : ${session.paymentUrl}`);
    logger.divider();
    logger.blank();
    logger.info("Next: once the payer completes the fiat payment (in production, your backend");
    logger.info("confirms this via the provider's webhook), mint the recipient's tokens using");
    logger.info("your existing deploy/mint commands, then run:");
    logger.info(`  ankara onramp-record --reference ${session.sessionId}`);
    logger.info("(any consistent reference string works — this session ID is just a suggestion,");
    logger.info(" since ManualRampProvider's session state only lives for this single command.)");
  } catch (err: any) {
    logger.error(err.message ?? String(err));
    process.exit(1);
  }
}
