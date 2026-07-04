import ora from "ora";
import inquirer from "inquirer";
import { ethers } from "ethers";
import { EVMAdapter, RampManager, ManualRampProvider } from "@ankarachain/sdk";
import { logger } from "../utils/logger.js";
import { readConfig, getPrivateKey, getRpcUrl } from "../utils/config.js";

export async function onrampRecordCommand() {
  logger.blank();
  console.log("  📝  Record On-Ramp Settlement (on-chain attestation)");
  logger.divider();
  logger.info("Writes a verifiable on-chain record tying a fiat settlement to a mint.");
  logger.info("Does not move funds — mint the recipient's tokens separately first.");
  logger.blank();

  const config = readConfig();

  const details = await inquirer.prompt([
    { type: "input", name: "settlement", message: "RampSettlement contract address:" },
    { type: "input", name: "reference",  message: "Reference string (from onramp-initiate, or any consistent ID):" },
    { type: "input", name: "recipient",  message: "Recipient address (who was minted tokens):" },
    { type: "input", name: "token",      message: "Token contract address that was minted:" },
    { type: "input", name: "amount",     message: "Amount minted (in token units):", default: "100" },
  ]);

  const spinner = ora("Recording on-ramp settlement…").start();

  try {
    const privateKey = getPrivateKey();
    const rpcUrl     = getRpcUrl(config);
    const provider   = new ethers.JsonRpcProvider(rpcUrl);
    const wallet     = new ethers.Wallet(privateKey, provider);

    const adapter = new EVMAdapter(config.network, provider, wallet);
    const ramp    = new RampManager(new ManualRampProvider(), adapter, { settlementAddress: details.settlement });

    const txHash = await ramp.recordOnRampSettlement(
      details.reference,
      details.recipient,
      details.token,
      ethers.parseEther(details.amount)
    );

    spinner.succeed("On-ramp settlement recorded on-chain");
    logger.info(`Tx hash: ${txHash}`);
  } catch (err: any) {
    spinner.fail("Recording failed");
    logger.error(err.message ?? String(err));
    process.exit(1);
  }
}
