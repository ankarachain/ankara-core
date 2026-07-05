import ora from "ora";
import inquirer from "inquirer";
import { ethers } from "ethers";
import { RampManager, ManualRampProvider } from "@ankarachain/sdk";
import { logger } from "../utils/logger.js";
import { readConfig, getPrivateKey, getRpcUrl, isStellarNetwork } from "../utils/config.js";
import { buildAdapter } from "../utils/adapter.js";

const ERC20_APPROVE_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
] as const;

export async function offrampInitiateCommand() {
  logger.blank();
  console.log("  🔴  Initiate Off-Ramp (tokens → fiat)");
  logger.divider();
  logger.info("Deposits tokens into RampSettlement custody and starts a provider payout session.");
  logger.blank();

  const config = readConfig();

  const details = await inquirer.prompt([
    { type: "input", name: "settlement",      message: "RampSettlement contract address:" },
    { type: "input", name: "token",           message: "Token contract address to off-ramp:" },
    { type: "input", name: "amount",          message: "Amount (in token units):", default: "100" },
    { type: "input", name: "fiatCurrency",    message: "Fiat currency to receive (e.g. NGN, KES, GHS):", default: "NGN" },
    { type: "input", name: "accountNumber",   message: "Payout account number:" },
    { type: "input", name: "bankCode",        message: "Bank code (leave blank for mobile money):", default: "" },
    { type: "input", name: "countryCode",     message: "Country code (ISO 3166-1 alpha-2):", default: "NG" },
  ]);

  const spinner = ora("Starting off-ramp session…").start();

  try {
    const rampProvider = new ManualRampProvider();
    const session = await rampProvider.initiateOffRamp({
      tokenAmount:  details.amount,
      tokenSymbol:  details.token,
      fiatCurrency: details.fiatCurrency,
      countryCode:  details.countryCode,
      payoutAccount: details.bankCode
        ? { type: "bank", accountNumber: details.accountNumber, bankCode: details.bankCode }
        : { type: "mobile-money", accountNumber: details.accountNumber },
    });

    const amountWei = ethers.parseEther(details.amount);

    // EVM needs an explicit ERC-20 approval before the settlement contract
    // can pull the funds; Stellar's deposit authorizes the nested SEP-41
    // transfer within the same call, so there's nothing to pre-approve there.
    if (!isStellarNetwork(config.network)) {
      spinner.text = "Approving tokens for settlement contract…";
      const privateKey = getPrivateKey();
      const rpcUrl      = getRpcUrl(config);
      const provider    = new ethers.JsonRpcProvider(rpcUrl);
      const wallet      = new ethers.Wallet(privateKey, provider);

      const token = new ethers.Contract(details.token, ERC20_APPROVE_ABI, wallet);
      await (await token.approve(details.settlement, amountWei)).wait();
    }

    spinner.text = "Depositing tokens into settlement contract…";

    const adapter = buildAdapter(config);
    const ramp    = new RampManager(rampProvider, adapter, { settlementAddress: details.settlement });
    const txHash  = await ramp.depositOffRamp(session.sessionId, details.token, amountWei);

    spinner.succeed(`Off-ramp initiated — ${details.amount} tokens deposited in custody`);
    logger.blank();
    logger.info(`Reference : ${session.sessionId}`);
    logger.info(`Tx hash   : ${txHash}`);
    logger.info("Next: once the fiat payout completes, run \"ankara offramp-confirm\" (SETTLER_ROLE).");
    logger.info("If the payout fails instead, run \"ankara offramp-refund\" (MANAGER_ROLE).");
  } catch (err: any) {
    spinner.fail("Off-ramp initiation failed");
    logger.error(err.message ?? String(err));
    process.exit(1);
  }
}
