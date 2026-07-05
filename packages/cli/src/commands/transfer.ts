import inquirer from "inquirer";
import ora from "ora";
import { ethers } from "ethers";
import { logger } from "../utils/logger.js";
import { readConfig, getRpcUrl, isStellarNetwork } from "../utils/config.js";
import { buildAdapter } from "../utils/adapter.js";

// Minimal ABI to detect ERC-721 — Soroban has no equivalent interface-
// detection mechanism (no ERC-165), so on Stellar we ask the user directly.
const DETECT_ABI = [
  "function supportsInterface(bytes4 interfaceId) view returns (bool)",
] as const;

const ERC721_INTERFACE_ID = "0x80ac58cd";

export async function transferCommand() {
  logger.blank();
  console.log("  ↗️  Transfer Tokens");
  logger.divider();
  logger.blank();

  const config = readConfig();

  const addressValidate = (v: string) =>
    isStellarNetwork(config.network) ? v.length > 0 || "Address is required" : ethers.isAddress(v) || "Invalid address";

  const { contractAddress } = await inquirer.prompt([{
    type: "input",
    name: "contractAddress",
    message: "Token / NFT contract address:",
    validate: addressValidate,
  }]);

  const adapter = buildAdapter(config);

  // ── Detect standard ───────────────────────────────────────────────────────
  let isNFT = false;
  if (isStellarNetwork(config.network)) {
    // No ERC-165 equivalent on Soroban — ask the user directly.
    const { assetKind } = await inquirer.prompt([{
      type: "list",
      name: "assetKind",
      message: "What kind of asset is this?",
      choices: [
        { name: "Fungible token (SEP-41)", value: "fungible" },
        { name: "NFT", value: "nft" },
      ],
    }]);
    isNFT = assetKind === "nft";
  } else {
    // Read-only ERC-165 probe — no signer needed for a view call.
    const rpcUrl = getRpcUrl(config);
    const provider = rpcUrl ? new ethers.JsonRpcProvider(rpcUrl) : new ethers.JsonRpcProvider();
    const detector = new ethers.Contract(contractAddress, DETECT_ABI, provider);
    try {
      isNFT = await detector.supportsInterface(ERC721_INTERFACE_ID);
    } catch {
      // Contract doesn't support ERC-165 — assume fungible.
    }
  }

  if (isNFT) {
    const { recipient, tokenId } = await inquirer.prompt([
      { type: "input", name: "recipient", message: "Recipient address:", validate: addressValidate },
      {
        type: "input",
        name: "tokenId",
        message: "Token ID:",
        validate: (v: string) => /^\d+$/.test(v) ? true : "Token ID must be a positive integer",
      },
    ]);

    logger.blank();
    logger.info(`Standard    : NFT`);
    logger.info(`Contract    : ${contractAddress}`);
    logger.info(`Token ID    : ${tokenId}`);
    logger.info(`To          : ${recipient}`);
    logger.divider();

    const { confirmed } = await inquirer.prompt([{
      type: "confirm", name: "confirmed", message: "Confirm transfer?", default: true,
    }]);
    if (!confirmed) { logger.info("Cancelled."); return; }

    const spinner = ora("Sending NFT transfer...").start();
    try {
      const txHash = await adapter.genericTransferNFT(contractAddress, recipient, BigInt(tokenId));
      spinner.succeed("NFT transferred!");
      logger.success(`Tx Hash : ${txHash}`);
    } catch (err: any) {
      spinner.fail("Transfer failed");
      logger.error(err.message ?? String(err));
      process.exit(1);
    }

  } else {
    const { recipient, amount } = await inquirer.prompt([
      { type: "input", name: "recipient", message: "Recipient address:", validate: addressValidate },
      {
        type: "input",
        name: "amount",
        message: "Amount (in token units, e.g. 100):",
        validate: (v: string) => parseFloat(v) > 0 ? true : "Amount must be > 0",
      },
    ]);

    const amountWei = ethers.parseEther(amount);

    logger.blank();
    logger.info(`Standard    : Fungible token`);
    logger.info(`Contract    : ${contractAddress}`);
    logger.info(`Amount      : ${amount} tokens`);
    logger.info(`To          : ${recipient}`);
    logger.divider();

    const { confirmed } = await inquirer.prompt([{
      type: "confirm", name: "confirmed", message: "Confirm transfer?", default: true,
    }]);
    if (!confirmed) { logger.info("Cancelled."); return; }

    const spinner = ora("Sending token transfer...").start();
    try {
      const txHash = await adapter.genericTransferToken(contractAddress, recipient, amountWei);
      spinner.succeed("Tokens transferred!");
      logger.success(`Tx Hash : ${txHash}`);
    } catch (err: any) {
      spinner.fail("Transfer failed");
      logger.error(err.message ?? String(err));
      process.exit(1);
    }
  }
}
