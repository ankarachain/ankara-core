import ora from "ora";
import inquirer from "inquirer";
import { ethers } from "ethers";
import { TokenFactory } from "@ankarachain/sdk";
import { logger } from "../utils/logger.js";
import {
  readConfig,
  addDeployment,
  getPrivateKey,
  getRpcUrl,
} from "../utils/config.js";

export async function deployRampSettlementCommand() {
  logger.blank();
  console.log("  💱  Deploy Ramp Settlement (fiat on/off-ramp)");
  logger.divider();
  logger.blank();

  const config = readConfig();

  if (!config.rampSettlementFactoryAddress) {
    logger.error("No rampSettlementFactoryAddress in ankara.config.json");
    logger.info('Add your deployed RampSettlementFactory address: "rampSettlementFactoryAddress": "0x..."');
    process.exit(1);
  }

  const { treasury } = await inquirer.prompt([{
    type: "input",
    name: "treasury",
    message: "Treasury address (receives settled off-ramp deposits):",
  }]);

  logger.blank();
  logger.divider();
  logger.info(`Treasury : ${treasury}`);
  logger.info(`Network  : ${config.network}`);
  logger.divider();
  logger.blank();

  const { confirmed } = await inquirer.prompt([{
    type: "confirm",
    name: "confirmed",
    message: "Deploy this RampSettlement contract?",
    default: true,
  }]);

  if (!confirmed) {
    logger.info("Cancelled.");
    return;
  }

  const spinner = ora("Deploying RampSettlement…").start();

  try {
    const privateKey = getPrivateKey();
    const rpcUrl     = getRpcUrl(config);
    const provider   = new ethers.JsonRpcProvider(rpcUrl);
    const signer     = new ethers.Wallet(privateKey, provider);

    const factory = new TokenFactory({
      network: config.network,
      signer,
      rampSettlementFactoryAddress: config.rampSettlementFactoryAddress,
    });

    const result = await factory.deployRampSettlement({ treasury });

    spinner.succeed(`RampSettlement deployed: ${result.settlementAddress}`);

    addDeployment({
      tokenAddress: result.settlementAddress,
      assetId:      "",
      template:     "ramp-settlement",
      name:         "Ramp Settlement",
      symbol:       "",
      countryCode:  "",
      txHash:       result.txHash,
      deployedAt:   result.deployedAt,
      network:      config.network,
    });

    logger.blank();
    logger.info(`Settlement : ${result.settlementAddress}`);
    logger.info(`Tx hash    : ${result.txHash}`);
    logger.info("Saved to ankara.config.json");
  } catch (err: any) {
    spinner.fail("Deployment failed");
    logger.error(err.message ?? String(err));
    process.exit(1);
  }
}
