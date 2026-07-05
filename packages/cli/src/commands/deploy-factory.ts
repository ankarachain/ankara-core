import { ethers } from "ethers";
import { NETWORKS } from "@ankarachain/sdk";
import { logger } from "../utils/logger.js";
import {
  readConfig,
  getPrivateKey,
  getStellarSecretKey,
  getRpcUrl,
  isStellarNetwork,
} from "../utils/config.js";

export async function deployFactoryCommand() {
  logger.blank();
  console.log("  🏭  Deploy TokenFactory");
  logger.divider();
  logger.blank();

  const config = readConfig();

  if (isStellarNetwork(config.network)) {
    const secretKey = getStellarSecretKey();
    logger.label("Network:", config.network);
    logger.blank();
    logger.warn("This command deploys the full Ankara Chain contract suite.");
    logger.blank();
    logger.info("Soroban contracts are built and deployed via the Cargo/stellar-cli");
    logger.info("toolchain, not a Hardhat script — run this from packages/contracts-stellar:");
    logger.blank();
    console.log("    cd packages/contracts-stellar");
    console.log("    npm run build   # compiles every contract to wasm32v1-none");
    console.log(
      `    stellar contract deploy --wasm target/wasm32v1-none/release/token_factory.wasm \\`
    );
    console.log(
      `      --source ${secretKey.slice(0, 4)}... --network ${config.network === "stellar-testnet" ? "testnet" : "mainnet"}`
    );
    logger.blank();
    logger.info("Repeat for nft-factory, multi-token-factory, escrow-factory,");
    logger.info("ramp-settlement-factory, and ankara-factory-registry as needed.");
    logger.info("Then paste the TokenFactory contract ID back into ankara.config.json");
    logger.info("or re-run: npx ankara init");
    logger.blank();
    return;
  }

  const privateKey = getPrivateKey();
  const rpcUrl     = getRpcUrl(config);
  const network    = NETWORKS[config.network];

  if (!network) throw new Error(`Unknown network: ${config.network}`);
  if (network.chainFamily !== "evm") {
    throw new Error(`Network ${config.network} is not configured as an EVM network.`);
  }

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
