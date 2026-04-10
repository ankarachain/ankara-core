import { mkdir, writeFile, existsSync } from "fs";
import { join } from "path";
import { promisify } from "util";
import inquirer from "inquirer";
import { logger } from "../utils/logger.js";
import { configExists, writeConfig } from "../utils/config.js";
import type { SupportedNetwork } from "@ankarachain/sdk";

const mkdirAsync = promisify(mkdir);

const FACTORY_ADDRESSES: Partial<Record<SupportedNetwork, string>> = {
  "localhost": "",      // filled after local deploy
  "polygon-amoy": "",  // filled after you deploy to Amoy
  "polygon": "",       // mainnet — future
};

export async function initCommand(projectName?: string) {
  logger.blank();
  console.log("  🌍  Ankara Chain SDK — Project Setup");
  logger.divider();
  logger.blank();

  // ── Already initialised? ──────────────────────────────────────────────────
  if (configExists() && !projectName) {
    logger.warn("ankara.config.json already exists in this directory.");
    const { overwrite } = await inquirer.prompt([{
      type: "confirm",
      name: "overwrite",
      message: "Reinitialise? This will reset your config (deployments kept).",
      default: false,
    }]);
    if (!overwrite) {
      logger.info("Aborted. Existing config unchanged.");
      return;
    }
  }

  // ── Prompts ───────────────────────────────────────────────────────────────
  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "projectName",
      message: "Project name:",
      default: projectName ?? "my-ankara-project",
    },
    {
      type: "list",
      name: "network",
      message: "Target network:",
      choices: [
        { name: "Polygon Amoy (testnet) — recommended for development", value: "polygon-amoy" },
        { name: "Localhost (Hardhat node)",                              value: "localhost"    },
        { name: "Polygon Mainnet",                                       value: "polygon"      },
        { name: "Celo Mainnet",                                          value: "celo"         },
        { name: "BNB Smart Chain",                                       value: "bnb"          },
        { name: "Ethereum Mainnet",                                      value: "ethereum"     },
      ],
      default: "polygon-amoy",
    },
    {
      type: "input",
      name: "factoryAddress",
      message: "TokenFactory contract address (leave blank if not deployed yet):",
      default: "",
    },
    {
      type: "input",
      name: "rpcUrl",
      message: "Custom RPC URL (leave blank to use default):",
      default: "",
    },
  ]);

  // ── Write config ──────────────────────────────────────────────────────────
  writeConfig({
    version:        "1.0",
    network:        answers.network as SupportedNetwork,
    factoryAddress: answers.factoryAddress || FACTORY_ADDRESSES[answers.network as SupportedNetwork] || "",
    rpcUrl:         answers.rpcUrl || undefined,
    deployments:    [],
  });

  // ── Write .env.example if missing ─────────────────────────────────────────
  const envPath = join(process.cwd(), ".env");
  if (!existsSync(envPath)) {
    const envContent = [
      "# Ankara Chain environment variables",
      "# NEVER commit this file to git\n",
      "PRIVATE_KEY=your_wallet_private_key_here",
      "RPC_URL=                  # optional override",
    ].join("\n");
    await promisify(writeFile)(envPath, envContent);
    logger.info("Created .env — add your PRIVATE_KEY");
  }

  logger.blank();
  logger.success(`Initialised: ${answers.projectName}`);
  logger.label("Network:",        answers.network);
  logger.label("Factory address:", answers.factoryAddress || "(not set — deploy first)");
  logger.label("Config file:",     "ankara.config.json");
  logger.divider();
  logger.blank();
  console.log("  Next steps:");
  console.log("    1. Add your PRIVATE_KEY to .env");
  if (!answers.factoryAddress) {
    console.log("    2. Deploy the factory:  npx ankara deploy-factory");
  }
  console.log("    3. Deploy a token:      npx ankara deploy --template farmland");
  logger.blank();
}
