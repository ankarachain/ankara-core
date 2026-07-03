import inquirer from "inquirer";
import { ethers } from "ethers";
import { POOL_VAULT_ABI } from "@ankarachain/sdk";
import { logger } from "../utils/logger.js";
import { readConfig, getRpcUrl } from "../utils/config.js";

export async function poolStatusCommand(opts: { vault?: string }) {
  logger.blank();
  console.log("  📊  Pool Vault Status");
  logger.divider();
  logger.blank();

  const config = readConfig();

  let vaultAddress = opts.vault;
  if (!vaultAddress) {
    const ans = await inquirer.prompt([
      { type: "input", name: "vault", message: "PoolVault address:" },
    ]);
    vaultAddress = ans.vault;
  }

  try {
    const rpcUrl  = getRpcUrl(config);
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const vault   = new ethers.Contract(vaultAddress!, POOL_VAULT_ABI, provider);

    const [
      name,
      symbol,
      totalSupply,
      navPerToken,
      totalAUM,
      managementFeeBps,
      acceptedTokens,
      lastFeeAccrual,
      oracle,
    ] = await Promise.all([
      vault.name(),
      vault.symbol(),
      vault.totalSupply(),
      vault.NAVPerToken(),
      vault.totalAUM(),
      vault.managementFeeBps(),
      vault.acceptedTokens(),
      vault.lastFeeAccrual(),
      vault.oracle(),
    ]);

    logger.blank();
    logger.divider();
    logger.info(`Name            : ${name} (${symbol})`);
    logger.info(`Total Supply    : ${ethers.formatEther(totalSupply)} pool tokens`);
    logger.info(`NAV per Token   : $${ethers.formatEther(navPerToken)}`);
    logger.info(`Total AUM       : $${ethers.formatEther(totalAUM)}`);
    logger.info(`Mgmt Fee        : ${managementFeeBps} bps (${Number(managementFeeBps) / 100}% /yr)`);
    logger.info(`Oracle          : ${oracle === ethers.ZeroAddress ? "none" : oracle}`);
    logger.info(`Last Fee Accrual: ${new Date(Number(lastFeeAccrual) * 1000).toISOString()}`);
    logger.info(`Accepted Tokens : ${acceptedTokens.length === 0 ? "none" : ""}`);
    for (const token of acceptedTokens) {
      logger.info(`  ${token}`);
    }
    logger.divider();
    logger.blank();
  } catch (err: any) {
    logger.error(err.message ?? String(err));
    process.exit(1);
  }
}
