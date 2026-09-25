import "dotenv/config";
import { program } from "commander";
import { initCommand }          from "./commands/init.js";
import { deployFactoryCommand } from "./commands/deploy-factory.js";
import { deployCommand }        from "./commands/deploy.js";
import { deployNFTCommand }     from "./commands/deploy-nft.js";
import { deployBatchCommand }   from "./commands/deploy-batch.js";
import { deployPoolCommand }    from "./commands/deploy-pool.js";
import { transferCommand }      from "./commands/transfer.js";
import { statusCommand }        from "./commands/status.js";
import { mintCommand }          from "./commands/mint.js";
import { registerBatchCommand } from "./commands/register-batch.js";
import { batchMintCommand }     from "./commands/batch-mint.js";
import { batchPayCommand }      from "./commands/batch-pay.js";
import { depositCommand }       from "./commands/deposit.js";
import { withdrawCommand }      from "./commands/withdraw.js";
import { poolStatusCommand }    from "./commands/pool-status.js";
import { oracleSetCommand }     from "./commands/oracle-set.js";
import { deployEscrowCommand }  from "./commands/deploy-escrow.js";
import { escrowFundCommand }    from "./commands/escrow-fund.js";
import { escrowDeliverCommand } from "./commands/escrow-deliver.js";
import { escrowApproveCommand } from "./commands/escrow-approve.js";
import { escrowDisputeCommand } from "./commands/escrow-dispute.js";
import { escrowResolveCommand } from "./commands/escrow-resolve.js";
import { escrowClaimTimelockCommand } from "./commands/escrow-claim-timelock.js";
import { escrowStatusCommand }  from "./commands/escrow-status.js";
import { deployRampSettlementCommand } from "./commands/deploy-ramp-settlement.js";
import { rampQuoteCommand }     from "./commands/ramp-quote.js";
import { onrampInitiateCommand } from "./commands/onramp-initiate.js";
import { onrampRecordCommand }  from "./commands/onramp-record.js";
import { offrampInitiateCommand } from "./commands/offramp-initiate.js";
import { offrampConfirmCommand } from "./commands/offramp-confirm.js";
import { offrampRefundCommand }  from "./commands/offramp-refund.js";
import { rampStatusCommand }    from "./commands/ramp-status.js";

program
  .name("ankara")
  .description("Ankara Chain CLI — deploy RWA tokens on-chain")
  .version("0.0.1");

// ── init ──────────────────────────────────────────────────────────────────────
program
  .command("init [projectName]")
  .description("Initialise a new Ankara Chain project in the current directory")
  .action(initCommand);

// ── deploy-factory ────────────────────────────────────────────────────────────
program
  .command("deploy-factory")
  .description("Deploy the Ankara Chain TokenFactory contract")
  .action(deployFactoryCommand);

// ── deploy ────────────────────────────────────────────────────────────────────
program
  .command("deploy")
  .description("Deploy a new RWA token from a template")
  .option("-t, --template <template>", "Asset template: farmland | commodity")
  .action((opts) => deployCommand(opts));

// ── status ────────────────────────────────────────────────────────────────────
program
  .command("status [tokenAddress]")
  .description("Show status of deployed tokens")
  .action(statusCommand);

// ── mint ──────────────────────────────────────────────────────────────────────
program
  .command("mint")
  .description("Mint tokens to an address")
  .option("-c, --contract <address>", "Token contract address")
  .option("-t, --to <address>",       "Recipient wallet address")
  .option("-a, --amount <amount>",    "Amount to mint")
  .action((opts) => mintCommand(opts));

// ── deploy-nft ────────────────────────────────────────────────────────────────
program
  .command("deploy-nft")
  .description("Deploy an NFT asset record contract (farmland | real-estate | mining-rights | commodity-vault)")
  .action(deployNFTCommand);

// ── deploy-batch ──────────────────────────────────────────────────────────────
program
  .command("deploy-batch")
  .description("Deploy a CommodityBatchToken (ERC-1155) warehouse receipt contract")
  .action(deployBatchCommand);

// ── deploy-pool ───────────────────────────────────────────────────────────────
program
  .command("deploy-pool")
  .description("Deploy a PoolVault (multi-asset ERC-20 fund)")
  .action(deployPoolCommand);

// ── register-batch ────────────────────────────────────────────────────────────
program
  .command("register-batch")
  .description("Register a new commodity batch on a CommodityBatchToken contract")
  .action(registerBatchCommand);

// ── batch-mint ────────────────────────────────────────────────────────────────
program
  .command("batch-mint")
  .description("Mint ERC-1155 commodity batch tokens to a recipient")
  .action(batchMintCommand);

// ── batch-pay ─────────────────────────────────────────────────────────────────
program
  .command("batch-pay")
  .description("Pay many recipients from a CSV (recipient,amount) via a Stellar batch-disburser contract")
  .option("--contract <address>", "BatchDisburser contract address")
  .option("--token <address>", "Token contract to pay in (e.g. USDC SAC)")
  .option("--file <path>", "CSV file with recipient,amount rows")
  .option("--reference <text>", "Reference string emitted on-chain")
  .option("-y, --yes", "Skip the confirmation prompt")
  .action(batchPayCommand);

// ── deposit ───────────────────────────────────────────────────────────────────
program
  .command("deposit")
  .description("Deposit an ERC-20 token into a PoolVault")
  .action(depositCommand);

// ── withdraw ──────────────────────────────────────────────────────────────────
program
  .command("withdraw")
  .description("Withdraw from a PoolVault by burning pool tokens")
  .action(withdrawCommand);

// ── pool-status ───────────────────────────────────────────────────────────────
program
  .command("pool-status")
  .description("Show NAV, AUM, accepted tokens, and fee info for a PoolVault")
  .option("-v, --vault <address>", "PoolVault contract address")
  .action((opts) => poolStatusCommand(opts));

// ── oracle-set ────────────────────────────────────────────────────────────────
program
  .command("oracle-set")
  .description("Set a token price on a ManualOracle")
  .action(oracleSetCommand);

// ── transfer ──────────────────────────────────────────────────────────────────
program
  .command("transfer")
  .description("Transfer ERC-20 tokens or ERC-721 NFTs (auto-detects standard)")
  .action(transferCommand);

// ── deploy-escrow ─────────────────────────────────────────────────────────────
program
  .command("deploy-escrow")
  .description("Deploy a MilestoneEscrow for tranche-based diaspora payments")
  .action(deployEscrowCommand);

// ── escrow-fund ───────────────────────────────────────────────────────────────
program
  .command("escrow-fund")
  .description("Approve and deposit the full amount into a MilestoneEscrow (payer only)")
  .action(escrowFundCommand);

// ── escrow-deliver ────────────────────────────────────────────────────────────
program
  .command("escrow-deliver")
  .description("Mark a milestone as delivered (payee only)")
  .action(escrowDeliverCommand);

// ── escrow-approve ────────────────────────────────────────────────────────────
program
  .command("escrow-approve")
  .description("Approve a delivered milestone, releasing funds to the payee (payer only)")
  .action(escrowApproveCommand);

// ── escrow-dispute ────────────────────────────────────────────────────────────
program
  .command("escrow-dispute")
  .description("Raise a dispute on a delivered milestone (payer or payee)")
  .action(escrowDisputeCommand);

// ── escrow-resolve ────────────────────────────────────────────────────────────
program
  .command("escrow-resolve")
  .description("Resolve a disputed milestone (arbiter only)")
  .action(escrowResolveCommand);

// ── escrow-claim-timelock ─────────────────────────────────────────────────────
program
  .command("escrow-claim-timelock")
  .description("Force-release a delivered milestone after the timelock elapses (anyone)")
  .action(escrowClaimTimelockCommand);

// ── escrow-status ─────────────────────────────────────────────────────────────
program
  .command("escrow-status")
  .description("Show status, balances, and milestones for a MilestoneEscrow")
  .option("-e, --escrow <address>", "Escrow contract address")
  .action((opts) => escrowStatusCommand(opts));

// ── deploy-ramp-settlement ─────────────────────────────────────────────────────
program
  .command("deploy-ramp-settlement")
  .description("Deploy a RampSettlement contract for fiat on/off-ramp flows")
  .action(deployRampSettlementCommand);

// ── ramp-quote ─────────────────────────────────────────────────────────────────
program
  .command("ramp-quote")
  .description("Get a fiat<->token quote (uses ManualRampProvider — swap in a real provider for production)")
  .action(rampQuoteCommand);

// ── onramp-initiate ────────────────────────────────────────────────────────────
program
  .command("onramp-initiate")
  .description("Start an on-ramp session (fiat -> tokens) with the ramp provider")
  .action(onrampInitiateCommand);

// ── onramp-record ──────────────────────────────────────────────────────────────
program
  .command("onramp-record")
  .description("Record an on-chain attestation that an on-ramp mint happened (SETTLER_ROLE)")
  .action(onrampRecordCommand);

// ── offramp-initiate ───────────────────────────────────────────────────────────
program
  .command("offramp-initiate")
  .description("Start an off-ramp session (tokens -> fiat): deposits tokens into RampSettlement custody")
  .action(offrampInitiateCommand);

// ── offramp-confirm ────────────────────────────────────────────────────────────
program
  .command("offramp-confirm")
  .description("Confirm an off-ramp fiat payout, releasing custodied tokens to the treasury (SETTLER_ROLE)")
  .action(offrampConfirmCommand);

// ── offramp-refund ─────────────────────────────────────────────────────────────
program
  .command("offramp-refund")
  .description("Refund a custodied off-ramp deposit if the fiat payout failed (MANAGER_ROLE)")
  .action(offrampRefundCommand);

// ── ramp-status ────────────────────────────────────────────────────────────────
program
  .command("ramp-status")
  .description("Show the on-chain off-ramp deposit / on-ramp record for a reference")
  .option("-s, --settlement <address>", "RampSettlement contract address")
  .action((opts) => rampStatusCommand(opts));

// Show help (exit 0) when no command is given instead of exiting with code 1
if (process.argv.length === 2) {
  program.outputHelp();
  process.exit(0);
}

program.parse();
