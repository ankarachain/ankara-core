import inquirer from "inquirer";
import { ManualRampProvider } from "@ankarachain/sdk";
import { logger } from "../utils/logger.js";

export async function rampQuoteCommand() {
  logger.blank();
  console.log("  💱  Ramp Quote");
  logger.divider();
  logger.info("Uses ManualRampProvider — a reference implementation for dev/testing.");
  logger.info("Swap in a real provider adapter (Yellow Card, Flutterwave, Transak, etc.) in production.");
  logger.blank();

  const details = await inquirer.prompt([
    { type: "list",  name: "direction",    message: "Direction:", choices: ["on-ramp", "off-ramp"] },
    { type: "input", name: "fiatCurrency", message: "Fiat currency (e.g. NGN, KES, GHS):", default: "NGN" },
    { type: "input", name: "tokenSymbol",  message: "Token symbol:", default: "mUSD" },
    { type: "input", name: "countryCode",  message: "Country code (ISO 3166-1 alpha-2):", default: "NG" },
    { type: "list",  name: "amountType",   message: "Amount is in:", choices: ["fiat", "token"] },
    { type: "input", name: "amount",       message: "Amount:", default: "100" },
  ]);

  try {
    const provider = new ManualRampProvider();
    const quote = await provider.getQuote({
      direction: details.direction,
      fiatCurrency: details.fiatCurrency,
      tokenSymbol: details.tokenSymbol,
      countryCode: details.countryCode,
      fiatAmount: details.amountType === "fiat" ? details.amount : undefined,
      tokenAmount: details.amountType === "token" ? details.amount : undefined,
    });

    logger.blank();
    logger.divider();
    logger.info(`Direction     : ${quote.direction}`);
    logger.info(`Fiat amount   : ${quote.fiatAmount} ${quote.fiatCurrency}`);
    logger.info(`Token amount  : ${quote.tokenAmount} ${quote.tokenSymbol}`);
    logger.info(`Exchange rate : ${quote.exchangeRate}`);
    logger.info(`Fee (fiat)    : ${quote.feeFiat} ${quote.fiatCurrency}`);
    logger.info(`Expires at    : ${new Date(quote.expiresAt * 1000).toISOString()}`);
    logger.divider();
    logger.blank();
  } catch (err: any) {
    logger.error(err.message ?? String(err));
    process.exit(1);
  }
}
