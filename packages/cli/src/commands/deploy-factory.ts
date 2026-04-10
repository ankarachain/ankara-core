import ora from "ora";
import { ethers } from "ethers";
import { NETWORKS } from "@ankarachain/sdk";
import { logger } from "../utils/logger.js";
import {
  readConfig,
  writeConfig,
  getPrivateKey,
  getRpcUrl,
} from "../utils/config.js";

// Minimal factory ABI for deployment
const FACTORY_BYTECODE_PLACEHOLDER = ""; // replaced by actual build artifact

export async function deployFactoryCommand() {
  logger.blank();
  console.log("  🏭  Deploy TokenFactory");
  logger.divider();
  logger.blank();

  const config     = readConfig();
  const privateKey = getPrivateKey();
  const rpcUrl     = getRpcUrl(config);
  const network    = NETWORKS[config.network];

  if (!network) throw new Error(`Unknown network: ${config.network}`);

  const provider = new ethers.JsonRpcProvider(
    rpcUrl || network.rpcUrl,
    network.chainId
  );
  const wallet   = new ethers.Wallet(privateKey, provider);

  logger.label("Network:",  config.network);
  logger.label("Deployer:", wallet.address);

  const balance = await provider.getBalance(wallet.address);
  logger.label("Balance:", `${ethers.formatEther(balance)} ${network.nativeCurrency.symbol}`);
  logger.blank();

  logger.warn("This command deploys the full Ankara Chain contract suite.");
  logger.warn("Make sure your wallet has enough gas.");
  logger.blank();

  // In real usage this reads from compiled artifacts.
  // For now we tell the user to use the Hardhat deploy script directly.
  logger.info("To deploy contracts, run the Hardhat deploy script from packages/contracts-evm:");
  logger.blank();
  console.log("    cd packages/contracts-evm");
  console.log(`    npx hardhat run scripts/deploy.ts --network ${config.network === "polygon-amoy" ? "amoy" : config.network}`);
  logger.blank();
  logger.info("Then paste the TokenFactory address back into ankara.config.json");
  logger.info("or re-run: npx ankara init");
  logger.blank();
}
