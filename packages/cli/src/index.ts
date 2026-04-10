import "dotenv/config";
import { program } from "commander";
import { initCommand }          from "./commands/init.js";
import { deployFactoryCommand } from "./commands/deploy-factory.js";
import { deployCommand }        from "./commands/deploy.js";
import { statusCommand }        from "./commands/status.js";
import { mintCommand }          from "./commands/mint.js";

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

program.parse();
