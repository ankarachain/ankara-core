import ora from "ora";
import inquirer from "inquirer";
import { ethers } from "ethers";
import { TokenFactory, type EscrowMilestoneInput } from "@ankarachain/sdk";
import { logger } from "../utils/logger.js";
import {
  readConfig,
  addDeployment,
  getPrivateKey,
  getRpcUrl,
} from "../utils/config.js";

export async function deployEscrowCommand() {
  logger.blank();
  console.log("  🤝  Deploy Milestone Escrow");
  logger.divider();
  logger.blank();

  const config = readConfig();

  if (!config.escrowFactoryAddress) {
    logger.error("No escrowFactoryAddress in ankara.config.json");
    logger.info('Add your deployed EscrowFactory address: "escrowFactoryAddress": "0x..."');
    process.exit(1);
  }

  const parties = await inquirer.prompt([
    { type: "input", name: "payer",  message: "Payer address (diaspora buyer, funds the escrow):" },
    { type: "input", name: "payee",  message: "Payee address (recipient of released funds):" },
    { type: "input", name: "arbiter", message: "Arbiter address (leave blank for none):", default: "" },
    { type: "input", name: "token",  message: "Stablecoin address (must be whitelisted on the factory):" },
    { type: "input", name: "timelockDays", message: "Timelock (days before payee can force-release):", default: "7" },
  ]);

  const milestones: EscrowMilestoneInput[] = [];
  const { count } = await inquirer.prompt([{
    type: "number",
    name: "count",
    message: "Number of milestones:",
    default: 3,
  }]);

  for (let i = 0; i < count; i++) {
    const m = await inquirer.prompt([
      { type: "input", name: "amount",      message: `Milestone ${i + 1} amount (in token units):`, default: "100" },
      { type: "input", name: "description", message: `Milestone ${i + 1} description:`, default: `Milestone ${i + 1}` },
    ]);
    milestones.push({
      amount: ethers.parseEther(m.amount),
      descriptionHash: ethers.keccak256(ethers.toUtf8Bytes(m.description)),
    });
  }

  const arbiter = parties.arbiter.trim() || undefined;
  const totalAmount = milestones.reduce((sum, m) => sum + m.amount, 0n);

  logger.blank();
  logger.divider();
  logger.info(`Payer       : ${parties.payer}`);
  logger.info(`Payee       : ${parties.payee}`);
  logger.info(`Arbiter     : ${arbiter ?? "none"}`);
  logger.info(`Token       : ${parties.token}`);
  logger.info(`Milestones  : ${milestones.length} (total ${ethers.formatEther(totalAmount)})`);
  logger.info(`Timelock    : ${parties.timelockDays} days`);
  logger.info(`Network     : ${config.network}`);
  logger.divider();
  logger.blank();

  const { confirmed } = await inquirer.prompt([{
    type: "confirm",
    name: "confirmed",
    message: "Deploy this escrow?",
    default: true,
  }]);

  if (!confirmed) {
    logger.info("Cancelled.");
    return;
  }

  const spinner = ora("Deploying MilestoneEscrow…").start();

  try {
    const privateKey = getPrivateKey();
    const rpcUrl     = getRpcUrl(config);
    const provider   = new ethers.JsonRpcProvider(rpcUrl);
    const signer     = new ethers.Wallet(privateKey, provider);

    const factory = new TokenFactory({
      network: config.network,
      signer,
      escrowFactoryAddress: config.escrowFactoryAddress,
    });

    const result = await factory.deployEscrow({
      payer:   parties.payer,
      payee:   parties.payee,
      arbiter,
      token:   parties.token,
      milestones,
      timelockDurationSeconds: parseInt(parties.timelockDays, 10) * 86_400,
    });

    spinner.succeed(`Escrow deployed: ${result.escrowAddress}`);

    addDeployment({
      tokenAddress: result.escrowAddress,
      assetId:      "",
      template:     "milestone-escrow",
      name:         "Milestone Escrow",
      symbol:       "",
      countryCode:  "",
      txHash:       result.txHash,
      deployedAt:   result.deployedAt,
      network:      config.network,
    });

    logger.blank();
    logger.info(`Escrow  : ${result.escrowAddress}`);
    logger.info(`Tx hash : ${result.txHash}`);
    logger.info("Saved to ankara.config.json");
    logger.blank();
    logger.info(`Next: the payer approves ${parties.token} and runs "ankara escrow-fund"`);
  } catch (err: any) {
    spinner.fail("Deployment failed");
    logger.error(err.message ?? String(err));
    process.exit(1);
  }
}
