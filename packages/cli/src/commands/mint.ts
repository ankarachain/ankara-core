import ora from "ora";
import inquirer from "inquirer";
import { ethers } from "ethers";
import { AssetRegistry } from "@ankarachain/sdk";
import { logger } from "../utils/logger.js";
import { readConfig, isStellarNetwork } from "../utils/config.js";
import { buildAdapter } from "../utils/adapter.js";

export async function mintCommand(opts: {
  contract?: string;
  to?: string;
  amount?: string;
}) {
  logger.blank();
  console.log("  🪙  Mint Tokens");
  logger.divider();
  logger.blank();

  const config = readConfig();

  // ── Resolve contract address ───────────────────────────────────────────
  let contractAddress = opts.contract;
  if (!contractAddress) {
    if (config.deployments.length === 0) {
      logger.error("No deployments found. Deploy a token first.");
      process.exit(1);
    }

    if (config.deployments.length === 1) {
      contractAddress = config.deployments[0].tokenAddress;
      logger.info(`Using: ${contractAddress}`);
    } else {
      const { chosen } = await inquirer.prompt([{
        type: "list",
        name: "chosen",
        message: "Select token contract:",
        choices: config.deployments.map(d => ({
          name:  `${d.name} (${d.symbol}) — ${d.tokenAddress}`,
          value: d.tokenAddress,
        })),
      }]);
      contractAddress = chosen;
    }
  }

  // ── Mint details ──────────────────────────────────────────────────────
  const answers = await inquirer.prompt([
    {
      type:    "input",
      name:    "to",
      message: "Recipient address:",
      default: opts.to,
      validate: (v: string) =>
        isStellarNetwork(config.network)
          ? v.length > 0 || "Address is required"
          : ethers.isAddress(v) || "Invalid Ethereum address",
    },
    {
      type:    "input",
      name:    "amount",
      message: "Amount to mint (in tokens):",
      default: opts.amount ?? "1000",
      validate: (v: string) => !isNaN(Number(v)) || "Must be a number",
    },
  ]);

  const amountWei = ethers.parseEther(answers.amount);

  logger.blank();
  logger.label("Contract:", contractAddress!);
  logger.label("To:",       answers.to);
  logger.label("Amount:",   `${answers.amount} tokens`);
  logger.blank();

  const { confirm } = await inquirer.prompt([{
    type: "confirm", name: "confirm",
    message: "Mint these tokens?", default: true,
  }]);
  if (!confirm) { logger.info("Cancelled."); return; }

  // ── Execute ───────────────────────────────────────────────────────────
  const spinner = ora("Minting...").start();

  try {
    const adapter = buildAdapter(config);

    const saved    = config.deployments.find(
      d => d.tokenAddress.toLowerCase() === contractAddress!.toLowerCase()
    );
    const template = (saved?.template as "farmland" | "commodity") ?? "farmland";
    const registry = new AssetRegistry(adapter, contractAddress!, template);

    const txHash = await registry.mint(answers.to, amountWei);

    spinner.succeed("Minted!");
    logger.blank();
    logger.label("Tx hash:", txHash);
    if (config.network === "polygon-amoy") {
      logger.info(`Explorer: https://amoy.polygonscan.com/tx/${txHash}`);
    }
    logger.blank();

  } catch (err: any) {
    spinner.fail("Mint failed");
    logger.error(err.message ?? String(err));
    process.exit(1);
  }
}
