import inquirer from "inquirer";
import ora from "ora";
import { ethers } from "ethers";
import { logger } from "../utils/logger.js";
import { readConfig, getPrivateKey, getRpcUrl } from "../utils/config.js";

// Minimal ABI to detect ERC-721 and handle both token types
const DETECT_ABI = [
  "function supportsInterface(bytes4 interfaceId) view returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 tokenId)",
] as const;

const ERC721_INTERFACE_ID = "0x80ac58cd";

export async function transferCommand() {
  logger.blank();
  console.log("  ↗️  Transfer Tokens");
  logger.divider();
  logger.blank();

  const config = readConfig();

  const { contractAddress } = await inquirer.prompt([{
    type: "input",
    name: "contractAddress",
    message: "Token / NFT contract address:",
    validate: (v: string) => ethers.isAddress(v) ? true : "Invalid address",
  }]);

  // ── Connect ───────────────────────────────────────────────────────────────
  const privateKey = getPrivateKey();
  const rpcUrl     = getRpcUrl(config);

  const provider = rpcUrl
    ? new ethers.JsonRpcProvider(rpcUrl)
    : new ethers.JsonRpcProvider();

  const signer  = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(contractAddress, DETECT_ABI, signer);

  // ── Detect standard ───────────────────────────────────────────────────────
  let isNFT = false;
  try {
    isNFT = await contract.supportsInterface(ERC721_INTERFACE_ID);
  } catch {
    // Contract doesn't support ERC-165 — assume ERC-20
  }

  if (isNFT) {
    // ── ERC-721 transfer ────────────────────────────────────────────────────
    const { recipient, tokenId } = await inquirer.prompt([
      {
        type: "input",
        name: "recipient",
        message: "Recipient address:",
        validate: (v: string) => ethers.isAddress(v) ? true : "Invalid address",
      },
      {
        type: "input",
        name: "tokenId",
        message: "Token ID:",
        validate: (v: string) => /^\d+$/.test(v) ? true : "Token ID must be a positive integer",
      },
    ]);

    logger.blank();
    logger.info(`Standard    : ERC-721 NFT`);
    logger.info(`Contract    : ${contractAddress}`);
    logger.info(`Token ID    : ${tokenId}`);
    logger.info(`To          : ${recipient}`);
    logger.divider();

    const { confirmed } = await inquirer.prompt([{
      type: "confirm",
      name: "confirmed",
      message: "Confirm transfer?",
      default: true,
    }]);
    if (!confirmed) { logger.info("Cancelled."); return; }

    const spinner = ora("Sending NFT transfer...").start();
    try {
      const signerAddress = await signer.getAddress();
      const tx = await contract.transferFrom(signerAddress, recipient, BigInt(tokenId));
      const receipt = await tx.wait();
      spinner.succeed("NFT transferred!");
      logger.success(`Tx Hash : ${receipt.hash}`);
    } catch (err: any) {
      spinner.fail("Transfer failed");
      logger.error(err.message ?? String(err));
      process.exit(1);
    }

  } else {
    // ── ERC-20 transfer ─────────────────────────────────────────────────────
    const { recipient, amount } = await inquirer.prompt([
      {
        type: "input",
        name: "recipient",
        message: "Recipient address:",
        validate: (v: string) => ethers.isAddress(v) ? true : "Invalid address",
      },
      {
        type: "input",
        name: "amount",
        message: "Amount (in token units, e.g. 100):",
        validate: (v: string) => parseFloat(v) > 0 ? true : "Amount must be > 0",
      },
    ]);

    const amountWei = ethers.parseEther(amount);

    logger.blank();
    logger.info(`Standard    : ERC-20`);
    logger.info(`Contract    : ${contractAddress}`);
    logger.info(`Amount      : ${amount} tokens`);
    logger.info(`To          : ${recipient}`);
    logger.divider();

    const { confirmed } = await inquirer.prompt([{
      type: "confirm",
      name: "confirmed",
      message: "Confirm transfer?",
      default: true,
    }]);
    if (!confirmed) { logger.info("Cancelled."); return; }

    const spinner = ora("Sending token transfer...").start();
    try {
      const tx = await contract.transfer(recipient, amountWei);
      const receipt = await tx.wait();
      spinner.succeed("Tokens transferred!");
      logger.success(`Tx Hash : ${receipt.hash}`);
    } catch (err: any) {
      spinner.fail("Transfer failed");
      logger.error(err.message ?? String(err));
      process.exit(1);
    }
  }
}
