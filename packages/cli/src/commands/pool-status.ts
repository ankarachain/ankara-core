import inquirer from "inquirer";
import { ethers } from "ethers";
import { logger } from "../utils/logger.js";
import { readConfig } from "../utils/config.js";
import { buildAdapter } from "../utils/adapter.js";

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
    const adapter = buildAdapter(config, { readOnly: true });
    const {
      name, symbol, totalSupply, navPerToken, totalAUM,
      managementFeeBps, acceptedTokens, lastFeeAccrual, oracle,
    } = await adapter.poolGetStatus(vaultAddress!);

    logger.blank();
    logger.divider();
    logger.info(`Name            : ${name} (${symbol})`);
    logger.info(`Total Supply    : ${ethers.formatEther(totalSupply)} pool tokens`);
    logger.info(`NAV per Token   : $${ethers.formatEther(navPerToken)}`);
    logger.info(`Total AUM       : $${ethers.formatEther(totalAUM)}`);
    logger.info(`Mgmt Fee        : ${managementFeeBps} bps (${managementFeeBps / 100}% /yr)`);
    logger.info(`Oracle          : ${oracle === "" ? "none" : oracle}`);
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
