/**
 * @ankarachain/mcp
 * Model Context Protocol server for Ankara Chain — deploy and manage RWA tokens via AI assistants.
 *
 * Every chain-touching tool works on EVM networks (`rpcUrl` + `privateKey`,
 * `network` defaults to `localhost`) and on Stellar/Soroban
 * (`network: "stellar" | "stellar-testnet"` + `stellarSecretKey`). A few
 * tools are Stellar-only because their contracts only exist there
 * (CollateralVault). See COVERAGE.md for the full SDK ↔ MCP ↔ CLI map.
 */

import { Server }              from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ethers } from "ethers";
import {
  EscrowManager,
  RampManager,
  AssetRegistry,
  CollateralVault,
  IndexerClient,
  ManualRampProvider,
  TOKEN_FACTORY_ABI,
  RAMP_SETTLEMENT_ABI,
  RampSettlementStatus,
  FARMLAND_TOKEN_ABI,
  MILESTONE_ESCROW_ABI,
} from "@ankarachain/sdk";
import type { AssetTemplate, AssetStatus, NFTAssetTemplate } from "@ankarachain/sdk";
import {
  CONNECTION_PROPS,
  READ_CONNECTION_PROPS,
  adapterFor,
  evmWallet,
  isStellar,
  signerAddress,
  stellarAdapterFor,
  tokenFactoryFor,
  type ConnectionArgs,
} from "./connection.js";
import { TEMPLATES, TEMPLATE_FIELDS, DEPLOY_METHOD, buildTemplateMetadata } from "./templates.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** JSON with bigints rendered as decimal strings (JSON.stringify throws on bigint). */
function toJson(data: unknown): string {
  return JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
}

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: toJson(data) }] };
}

function err(message: string) {
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

/** Token amounts are passed in whole units ("100" = 100 tokens, 18 decimals). */
const units = (amount: unknown) => ethers.parseEther(String(amount));
const fromUnits = (amount: bigint) => ethers.formatEther(amount);

type Args = Record<string, unknown> & ConnectionArgs;

const STATUS_LABELS = ["DRAFT", "ACTIVE", "SUSPENDED", "REDEEMED", "EXPIRED"];

// ─── Tool definitions ────────────────────────────────────────────────────────

const ASSET_ACTIONS = [
  "set_status", "set_identity_verifier", "pause", "unpause", "mint",
  "update_valuation", "update_occupancy_status", "declare_rental_distribution",
  "mark_expired", "mark_funded", "mark_repaid", "mark_defaulted",
  "retire", "renew_license", "mark_license_expired", "declare_royalty",
] as const;

const TOOLS = [
  // ── Tokens ─────────────────────────────────────────────────────────────
  {
    name: "get_template_fields",
    description: "List the metadata fields (with units, defaults and allowed values) each fungible RWA template accepts in deploy_token's `metadata` argument. No chain call.",
    inputSchema: {
      type: "object",
      properties: {
        template: { type: "string", enum: TEMPLATES, description: "Omit to list all six templates" },
      },
    },
  },
  {
    name: "deploy_token",
    description: "Deploy a fungible RWA token (farmland, commodity, real-estate, invoice, carbon-credit, mining-rights) via the Ankara Chain TokenFactory, on EVM or Stellar. `metadata` takes the template's fields (see get_template_fields); omitted fields use the same defaults as the CLI's `ankara deploy`.",
    inputSchema: {
      type: "object",
      properties: {
        template:         { type: "string", enum: TEMPLATES },
        name:             { type: "string", description: "Token name" },
        symbol:           { type: "string", description: "Token symbol (3-5 chars)" },
        assetId:          { type: "string", description: "Unique asset identifier string" },
        countryCode:      { type: "string", description: "ISO 3166-1 alpha-2 country code" },
        metadata:         { type: "object", description: "Template-specific fields — see get_template_fields", additionalProperties: true },
        identityVerifier: { type: "string", description: "Optional identity-verifier contract address" },
        factoryAddress:   { type: "string", description: "Deployed TokenFactory contract address" },
        ...CONNECTION_PROPS,
      },
      required: ["template", "name", "symbol", "assetId", "countryCode", "factoryAddress"],
    },
  },
  {
    name: "deploy_nft",
    description: "Deploy an NFT asset record contract (farmland-nft, real-estate-nft, mining-rights-nft, commodity-vault-nft) via the Ankara Chain NFTFactory, on EVM or Stellar.",
    inputSchema: {
      type: "object",
      properties: {
        template:          { type: "string", enum: ["farmland-nft", "real-estate-nft", "mining-rights-nft", "commodity-vault-nft"] },
        name:              { type: "string" },
        symbol:            { type: "string" },
        assetId:           { type: "string" },
        countryCode:       { type: "string" },
        nftFactoryAddress: { type: "string", description: "Deployed NFTFactory contract address" },
        ...CONNECTION_PROPS,
      },
      required: ["template", "name", "symbol", "assetId", "countryCode", "nftFactoryAddress"],
    },
  },
  {
    name: "mint_tokens",
    description: "Mint fungible RWA tokens to a recipient address (Minter role).",
    inputSchema: {
      type: "object",
      properties: {
        contractAddress: { type: "string" },
        to:              { type: "string", description: "Recipient wallet address" },
        amount:          { type: "string", description: "Amount to mint in whole tokens (e.g. '100')" },
        ...CONNECTION_PROPS,
      },
      required: ["contractAddress", "to", "amount"],
    },
  },
  {
    name: "transfer_tokens",
    description: "Transfer fungible tokens from the signer to another address.",
    inputSchema: {
      type: "object",
      properties: {
        contractAddress: { type: "string" },
        to:              { type: "string" },
        amount:          { type: "string", description: "Whole tokens" },
        ...CONNECTION_PROPS,
      },
      required: ["contractAddress", "to", "amount"],
    },
  },
  {
    name: "transfer_nft",
    description: "Transfer an NFT (asset record) from the signer to another address.",
    inputSchema: {
      type: "object",
      properties: {
        contractAddress: { type: "string" },
        to:              { type: "string" },
        tokenId:         { type: "string" },
        ...CONNECTION_PROPS,
      },
      required: ["contractAddress", "to", "tokenId"],
    },
  },
  {
    name: "get_token_balance",
    description: "Read a holder's balance of a token (read-only).",
    inputSchema: {
      type: "object",
      properties: {
        contractAddress: { type: "string" },
        holder:          { type: "string" },
        ...READ_CONNECTION_PROPS,
      },
      required: ["contractAddress", "holder"],
    },
  },
  {
    name: "get_token_status",
    description: "Get name, symbol, total supply, and asset status of an Ankara Chain token.",
    inputSchema: {
      type: "object",
      properties: {
        contractAddress: { type: "string" },
        ...READ_CONNECTION_PROPS,
      },
      required: ["contractAddress"],
    },
  },
  {
    name: "get_asset_details",
    description: "Read an Ankara RWA token's full on-chain record: name, symbol, supply, status, country, verifier, metadata version, template metadata, plus template-specific state (invoice status/overdue, commodity expiry, carbon retirements, mining license expiry).",
    inputSchema: {
      type: "object",
      properties: {
        contractAddress: { type: "string" },
        template:        { type: "string", enum: TEMPLATES },
        ...READ_CONNECTION_PROPS,
      },
      required: ["contractAddress", "template"],
    },
  },
  {
    name: "asset_action",
    description: "Run a lifecycle / template-specific action on an Ankara RWA token via AssetRegistry. Actions and their `params`: set_status {status 0-4}; set_identity_verifier {verifier}; pause; unpause; mint {to, amount}; update_valuation {valuationUSD} (farmland, real-estate); update_occupancy_status {status} (real-estate); declare_rental_distribution {amountUSD} (real-estate); mark_expired (commodity); mark_funded / mark_repaid / mark_defaulted {reason} (invoice); retire {amount, beneficiary, note} (carbon-credit); renew_license {expiryDays} / mark_license_expired / declare_royalty {extractionValueUSD} (mining-rights).",
    inputSchema: {
      type: "object",
      properties: {
        contractAddress: { type: "string" },
        template:        { type: "string", enum: TEMPLATES },
        action:          { type: "string", enum: ASSET_ACTIONS },
        params:          { type: "object", additionalProperties: true },
        ...CONNECTION_PROPS,
      },
      required: ["contractAddress", "template", "action"],
    },
  },
  {
    name: "set_asset_status",
    description: "Set the lifecycle status of an Ankara Chain token (0=DRAFT, 1=ACTIVE, 2=SUSPENDED, 3=REDEEMED, 4=EXPIRED).",
    inputSchema: {
      type: "object",
      properties: {
        contractAddress: { type: "string" },
        status:          { type: "number", minimum: 0, maximum: 4 },
        ...CONNECTION_PROPS,
      },
      required: ["contractAddress", "status"],
    },
  },
  {
    name: "list_deployments",
    description: "List all token contracts deployed by a given address via the Ankara Chain TokenFactory.",
    inputSchema: {
      type: "object",
      properties: {
        factoryAddress:  { type: "string" },
        deployerAddress: { type: "string" },
        ...READ_CONNECTION_PROPS,
      },
      required: ["factoryAddress", "deployerAddress"],
    },
  },

  // ── Multi-token / pool vault / oracle ──────────────────────────────────
  {
    name: "deploy_batch_token",
    description: "Deploy a CommodityBatchToken (multi-token warehouse receipt) via the Ankara Chain MultiTokenFactory.",
    inputSchema: {
      type: "object",
      properties: {
        name:                     { type: "string", description: "Warehouse contract name" },
        countryCode:              { type: "string" },
        baseURI:                  { type: "string", description: "Base IPFS URI for token metadata" },
        warehouseId:              { type: "string" },
        warehouseLocation:        { type: "string" },
        multiTokenFactoryAddress: { type: "string", description: "Deployed MultiTokenFactory contract address" },
        ...CONNECTION_PROPS,
      },
      required: ["name", "countryCode", "baseURI", "warehouseId", "warehouseLocation", "multiTokenFactoryAddress"],
    },
  },
  {
    name: "deploy_pool_vault",
    description: "Deploy a PoolVault (multi-asset fund) via the Ankara Chain MultiTokenFactory.",
    inputSchema: {
      type: "object",
      properties: {
        name:                     { type: "string" },
        symbol:                   { type: "string" },
        assetId:                  { type: "string", description: "Unique asset identifier string" },
        countryCode:              { type: "string" },
        oracle:                   { type: "string", description: "Oracle contract address (optional)" },
        managementFeeBps:         { type: "number", description: "Annual management fee in basis points (default 0)" },
        multiTokenFactoryAddress: { type: "string", description: "Deployed MultiTokenFactory contract address" },
        ...CONNECTION_PROPS,
      },
      required: ["name", "symbol", "assetId", "countryCode", "multiTokenFactoryAddress"],
    },
  },
  {
    name: "batch_register",
    description: "Register a new commodity batch (id + metadata) on a CommodityBatchToken.",
    inputSchema: {
      type: "object",
      properties: {
        contractAddress:     { type: "string" },
        batchId:             { type: "string" },
        commodityType:       { type: "string" },
        quantityKg:          { type: "string" },
        gradeClassification: { type: "string" },
        harvestSeason:       { type: "string" },
        originCountry:       { type: "string", description: "ISO 3166-1 alpha-2" },
        valuationUSD:        { type: "string", description: "Whole USD" },
        expiryDays:          { type: "number", description: "Days from now (default 365)" },
        ...CONNECTION_PROPS,
      },
      required: ["contractAddress", "batchId", "commodityType", "quantityKg", "gradeClassification", "harvestSeason", "originCountry", "valuationUSD"],
    },
  },
  {
    name: "batch_mint",
    description: "Mint units of a registered commodity batch to a recipient.",
    inputSchema: {
      type: "object",
      properties: {
        contractAddress: { type: "string" },
        batchId:         { type: "string" },
        to:              { type: "string" },
        amount:          { type: "string", description: "Units to mint (integer)" },
        ...CONNECTION_PROPS,
      },
      required: ["contractAddress", "batchId", "to", "amount"],
    },
  },
  {
    name: "pool_deposit",
    description: "Deposit an accepted token into a PoolVault and receive pool shares priced at NAV.",
    inputSchema: {
      type: "object",
      properties: {
        vaultAddress: { type: "string" },
        token:        { type: "string", description: "Accepted token to deposit" },
        amount:       { type: "string", description: "Whole tokens" },
        ...CONNECTION_PROPS,
      },
      required: ["vaultAddress", "token", "amount"],
    },
  },
  {
    name: "pool_withdraw",
    description: "Burn pool shares and withdraw the proportional basket of underlying tokens.",
    inputSchema: {
      type: "object",
      properties: {
        vaultAddress:    { type: "string" },
        poolTokenAmount: { type: "string", description: "Whole pool shares" },
        ...CONNECTION_PROPS,
      },
      required: ["vaultAddress", "poolTokenAmount"],
    },
  },
  {
    name: "get_pool_status",
    description: "Read a PoolVault's supply, NAV per share, AUM, fee, accepted tokens and oracle (read-only).",
    inputSchema: {
      type: "object",
      properties: { vaultAddress: { type: "string" }, ...READ_CONNECTION_PROPS },
      required: ["vaultAddress"],
    },
  },
  {
    name: "oracle_set_price",
    description: "Post a USD price (whole dollars, stored at 1e18 scale) for a token on a ManualOracle (Manager only).",
    inputSchema: {
      type: "object",
      properties: {
        oracleAddress: { type: "string" },
        token:         { type: "string" },
        priceUSD:      { type: "string", description: "e.g. '1.25'" },
        ...CONNECTION_PROPS,
      },
      required: ["oracleAddress", "token", "priceUSD"],
    },
  },

  // ── Collateral vault (Stellar-only) ────────────────────────────────────
  {
    name: "vault_open_loan",
    description: "Stellar-only. Pledge an RWA token as collateral in a CollateralVault and borrow up to its LTV against the oracle price.",
    inputSchema: {
      type: "object",
      properties: {
        vaultAddress:     { type: "string" },
        collateralToken:  { type: "string" },
        collateralAmount: { type: "string", description: "Collateral amount in the token's smallest unit" },
        borrowAmount:     { type: "string", description: "Borrowed amount in the borrowed token's smallest unit" },
        ...CONNECTION_PROPS,
      },
      required: ["vaultAddress", "collateralToken", "collateralAmount", "borrowAmount", "network"],
    },
  },
  {
    name: "vault_repay_loan",
    description: "Stellar-only. Repay a CollateralVault loan in full and release its collateral.",
    inputSchema: {
      type: "object",
      properties: { vaultAddress: { type: "string" }, loanId: { type: "number" }, ...CONNECTION_PROPS },
      required: ["vaultAddress", "loanId", "network"],
    },
  },
  {
    name: "vault_liquidate",
    description: "Stellar-only. Liquidate an undercollateralized CollateralVault loan (callable by anyone once eligible).",
    inputSchema: {
      type: "object",
      properties: { vaultAddress: { type: "string" }, loanId: { type: "number" }, ...CONNECTION_PROPS },
      required: ["vaultAddress", "loanId", "network"],
    },
  },
  {
    name: "get_loan",
    description: "Stellar-only. Read a CollateralVault loan with its live LTV and liquidation status, or the vault's config if loanId is omitted (read-only).",
    inputSchema: {
      type: "object",
      properties: { vaultAddress: { type: "string" }, loanId: { type: "number" }, ...READ_CONNECTION_PROPS },
      required: ["vaultAddress", "network"],
    },
  },

  // ── Escrow ─────────────────────────────────────────────────────────────
  {
    name: "deploy_escrow",
    description: "Deploy a MilestoneEscrow for tranche-based payments via the Ankara Chain EscrowFactory.",
    inputSchema: {
      type: "object",
      properties: {
        payer:                   { type: "string", description: "Payer address (funds the escrow)" },
        payee:                   { type: "string", description: "Payee address (receives released funds)" },
        arbiter:                 { type: "string", description: "Optional arbiter address for dispute resolution" },
        token:                   { type: "string", description: "Stablecoin address" },
        milestones: {
          type: "array",
          description: "Ordered list of milestone amounts in whole tokens (e.g. '100')",
          items: { type: "string" },
        },
        timelockDurationSeconds: { type: "number", description: "Seconds before a delivered milestone can be force-released (default 7 days)" },
        escrowFactoryAddress:    { type: "string", description: "Deployed EscrowFactory contract address" },
        ...CONNECTION_PROPS,
      },
      required: ["payer", "payee", "token", "milestones", "escrowFactoryAddress"],
    },
  },
  {
    name: "fund_escrow",
    description: "Fund a MilestoneEscrow (payer only). Funds one milestone if milestoneId is given, otherwise every milestone not yet funded. On EVM the token approval is done first.",
    inputSchema: {
      type: "object",
      properties: {
        escrowAddress: { type: "string" },
        milestoneId:   { type: "number", description: "Optional — omit to fund all unfunded milestones" },
        ...CONNECTION_PROPS,
      },
      required: ["escrowAddress"],
    },
  },
  ...(["mark_milestone_delivered", "approve_milestone", "raise_dispute", "claim_timelock_release"] as const).map((name) => ({
    name,
    description: {
      mark_milestone_delivered: "Mark a milestone as delivered on a MilestoneEscrow. Payee only.",
      approve_milestone: "Approve a delivered milestone, releasing funds to the payee. Payer only.",
      raise_dispute: "Raise a dispute on a delivered milestone. Payer or payee only.",
      claim_timelock_release: "Force-release a delivered milestone after the timelock has elapsed with no dispute raised. Callable by anyone.",
    }[name],
    inputSchema: {
      type: "object",
      properties: { escrowAddress: { type: "string" }, milestoneId: { type: "number" }, ...CONNECTION_PROPS },
      required: ["escrowAddress", "milestoneId"],
    },
  })),
  {
    name: "resolve_dispute",
    description: "Resolve a disputed milestone. Arbiter only.",
    inputSchema: {
      type: "object",
      properties: {
        escrowAddress:  { type: "string" },
        milestoneId:    { type: "number" },
        releaseToPayee: { type: "boolean", description: "true = release funds to payee, false = refund to payer" },
        ...CONNECTION_PROPS,
      },
      required: ["escrowAddress", "milestoneId", "releaseToPayee"],
    },
  },
  {
    name: "vote_cancel_escrow",
    description: "Vote to cancel a MilestoneEscrow (payer or payee); cancels once both have voted, refunding unreleased funded milestones.",
    inputSchema: {
      type: "object",
      properties: { escrowAddress: { type: "string" }, ...CONNECTION_PROPS },
      required: ["escrowAddress"],
    },
  },
  {
    name: "get_escrow_status",
    description: "Read status, balances, and milestones for a MilestoneEscrow (read-only, no key required).",
    inputSchema: {
      type: "object",
      properties: { escrowAddress: { type: "string" }, ...READ_CONNECTION_PROPS },
      required: ["escrowAddress"],
    },
  },

  // ── Ramp ───────────────────────────────────────────────────────────────
  {
    name: "deploy_ramp_settlement",
    description: "Deploy a RampSettlement contract (optional on-chain half of a fiat on/off-ramp flow) via the Ankara Chain RampSettlementFactory.",
    inputSchema: {
      type: "object",
      properties: {
        treasury:                     { type: "string", description: "Address that receives settled off-ramp deposits" },
        rampSettlementFactoryAddress: { type: "string", description: "Deployed RampSettlementFactory contract address" },
        ...CONNECTION_PROPS,
      },
      required: ["treasury", "rampSettlementFactoryAddress"],
    },
  },
  {
    name: "get_ramp_quote",
    description: "Get a fiat<->token quote using ManualRampProvider (a reference implementation — swap in a real provider adapter for production).",
    inputSchema: {
      type: "object",
      properties: {
        direction:    { type: "string", enum: ["on-ramp", "off-ramp"] },
        fiatCurrency: { type: "string", description: "e.g. NGN, KES, GHS" },
        tokenSymbol:  { type: "string" },
        countryCode:  { type: "string", description: "ISO 3166-1 alpha-2" },
        fiatAmount:   { type: "string", description: "Provide either fiatAmount or tokenAmount" },
        tokenAmount:  { type: "string" },
      },
      required: ["direction", "fiatCurrency", "tokenSymbol", "countryCode"],
    },
  },
  {
    name: "initiate_onramp",
    description: "Start an on-ramp session (fiat -> tokens) with the ramp provider. Does not mint tokens — mint separately once the fiat payment is confirmed.",
    inputSchema: {
      type: "object",
      properties: {
        fiatAmount:       { type: "string" },
        fiatCurrency:     { type: "string" },
        tokenSymbol:      { type: "string" },
        recipientAddress: { type: "string" },
        countryCode:      { type: "string" },
      },
      required: ["fiatAmount", "fiatCurrency", "tokenSymbol", "recipientAddress", "countryCode"],
    },
  },
  {
    name: "record_onramp_settlement",
    description: "Record an on-chain attestation that an on-ramp mint happened. Does not move funds — mint the recipient's tokens separately first.",
    inputSchema: {
      type: "object",
      properties: {
        settlementAddress: { type: "string" },
        reference:         { type: "string", description: "Reference string from initiate_onramp, or any consistent ID" },
        recipient:         { type: "string" },
        token:             { type: "string" },
        amount:            { type: "string", description: "Amount minted in whole tokens" },
        ...CONNECTION_PROPS,
      },
      required: ["settlementAddress", "reference", "recipient", "token", "amount"],
    },
  },
  {
    name: "initiate_offramp",
    description: "Start an off-ramp session (tokens -> fiat): deposits tokens into RampSettlement custody and starts a provider payout session.",
    inputSchema: {
      type: "object",
      properties: {
        settlementAddress: { type: "string" },
        token:             { type: "string" },
        amount:            { type: "string", description: "Amount to off-ramp in whole tokens" },
        fiatCurrency:      { type: "string" },
        countryCode:       { type: "string" },
        accountNumber:     { type: "string" },
        bankCode:          { type: "string", description: "Leave blank for mobile money" },
        ...CONNECTION_PROPS,
      },
      required: ["settlementAddress", "token", "amount", "fiatCurrency", "countryCode", "accountNumber"],
    },
  },
  ...(["confirm_offramp_settlement", "refund_offramp"] as const).map((name) => ({
    name,
    description: name === "confirm_offramp_settlement"
      ? "Confirm an off-ramp fiat payout, releasing custodied tokens to the treasury."
      : "Refund a custodied off-ramp deposit to the original depositor if the fiat payout failed.",
    inputSchema: {
      type: "object",
      properties: { settlementAddress: { type: "string" }, reference: { type: "string" }, ...CONNECTION_PROPS },
      required: ["settlementAddress", "reference"],
    },
  })),
  {
    name: "get_ramp_status",
    description: "Read the on-chain off-ramp deposit / on-ramp record for a reference (read-only, no key required).",
    inputSchema: {
      type: "object",
      properties: { settlementAddress: { type: "string" }, reference: { type: "string" }, ...READ_CONNECTION_PROPS },
      required: ["settlementAddress", "reference"],
    },
  },

  // ── Indexer ────────────────────────────────────────────────────────────
  {
    name: "query_indexer_events",
    description: "Query indexed contract events from a running @ankarachain/indexer service (no chain call).",
    inputSchema: {
      type: "object",
      properties: {
        indexerUrl: { type: "string", description: "Base URL of the indexer service" },
        contract:   { type: "string" },
        type:       { type: "string", description: "Event type, e.g. 'opened', 'deposit'" },
        since:      { type: "number", description: "Unix seconds" },
        limit:      { type: "number" },
      },
      required: ["indexerUrl"],
    },
  },
];

// ─── Token handlers ──────────────────────────────────────────────────────────

function handleGetTemplateFields(args: Args) {
  const template = args.template as AssetTemplate | undefined;
  if (template) {
    if (!TEMPLATE_FIELDS[template]) throw new Error(`Unknown template: ${template}`);
    return { template, fields: TEMPLATE_FIELDS[template] };
  }
  return TEMPLATES.map((t) => ({ template: t, fields: TEMPLATE_FIELDS[t] }));
}

async function handleDeployToken(args: Args) {
  const template = args.template as AssetTemplate;
  if (!DEPLOY_METHOD[template]) {
    throw new Error(`Unsupported template: ${template}. Expected one of: ${TEMPLATES.join(", ")}`);
  }
  const signer = await signerAddress(args);
  // Validate/build metadata before touching the network.
  const metadata = buildTemplateMetadata(template, (args.metadata as Record<string, unknown>) ?? {}, { signer });
  const factory = tokenFactoryFor(args, { factoryAddress: args.factoryAddress as string });
  const deploy = (factory as unknown as Record<string, (o: unknown) => Promise<{ tokenAddress: string; txHash: string }>>)[DEPLOY_METHOD[template]];
  const result = await deploy.call(factory, {
    name: args.name,
    symbol: args.symbol,
    assetId: args.assetId,
    countryCode: args.countryCode,
    admin: signer,
    identityVerifier: args.identityVerifier as string | undefined,
    metadata,
  });
  return { template, network: args.network ?? "localhost", contractAddress: result.tokenAddress, txHash: result.txHash };
}

async function handleDeployNFT(args: Args) {
  const methods: Record<NFTAssetTemplate, string> = {
    "farmland-nft": "deployFarmlandNFT",
    "real-estate-nft": "deployRealEstateNFT",
    "mining-rights-nft": "deployMiningRightsNFT",
    "commodity-vault-nft": "deployCommodityVaultNFT",
  };
  const method = methods[args.template as NFTAssetTemplate];
  if (!method) throw new Error(`Unknown NFT template: ${args.template}`);
  const factory = tokenFactoryFor(args, { nftFactoryAddress: args.nftFactoryAddress as string });
  const deploy = (factory as unknown as Record<string, (o: unknown) => Promise<{ nftAddress: string; txHash: string }>>)[method];
  // NFT metadata is per-token (attached at mint), not per-contract.
  const result = await deploy.call(factory, {
    name: args.name, symbol: args.symbol, assetId: args.assetId, countryCode: args.countryCode, metadata: {},
  });
  return { contractAddress: result.nftAddress, txHash: result.txHash };
}

async function handleMintTokens(args: Args) {
  if (isStellar(args)) {
    const txHash = await adapterFor(args).mintTokens(args.contractAddress as string, args.to as string, units(args.amount));
    return { txHash, to: args.to, amount: args.amount };
  }
  const w = evmWallet(args);
  const contract = new ethers.Contract(args.contractAddress as string, FARMLAND_TOKEN_ABI, w);
  const tx = await contract.mint(args.to, units(args.amount));
  const receipt = await tx.wait();
  return { txHash: receipt.hash, to: args.to, amount: args.amount };
}

async function handleTransferTokens(args: Args) {
  const txHash = await adapterFor(args).genericTransferToken(args.contractAddress as string, args.to as string, units(args.amount));
  return { txHash, to: args.to, amount: args.amount };
}

async function handleTransferNFT(args: Args) {
  const txHash = await adapterFor(args).genericTransferNFT(args.contractAddress as string, args.to as string, BigInt(String(args.tokenId)));
  return { txHash, to: args.to, tokenId: args.tokenId };
}

async function handleGetTokenBalance(args: Args) {
  const balance = await adapterFor(args, {}, { readOnly: true }).getBalance2(args.contractAddress as string, args.holder as string);
  return { holder: args.holder, balance: fromUnits(balance), raw: balance };
}

async function handleGetTokenStatus(args: Args) {
  if (isStellar(args)) {
    const adapter = adapterFor(args, {}, { readOnly: true });
    const address = args.contractAddress as string;
    const [meta, totalSupply, status] = await Promise.all([
      adapter.genericGetTokenMetadata(address),
      adapter.assetGetTotalSupply(address, "farmland"),
      adapter.assetGetStatus(address, "farmland"),
    ]);
    return {
      name: meta.name, symbol: meta.symbol, totalSupply: fromUnits(totalSupply),
      status: Number(status), statusLabel: STATUS_LABELS[Number(status)] ?? "UNKNOWN",
    };
  }
  const provider = new ethers.JsonRpcProvider(args.rpcUrl);
  const contract = new ethers.Contract(args.contractAddress as string, FARMLAND_TOKEN_ABI, provider);
  const [name, symbol, totalSupply, status] = await Promise.all([
    contract.name(),
    contract.symbol(),
    contract.totalSupply(),
    contract.status(),
  ]);
  return {
    name,
    symbol,
    totalSupply: ethers.formatEther(totalSupply),
    status: Number(status),
    statusLabel: STATUS_LABELS[Number(status)] ?? "UNKNOWN",
  };
}

async function handleGetAssetDetails(args: Args) {
  const template = args.template as AssetTemplate;
  const registry = new AssetRegistry(adapterFor(args, {}, { readOnly: true }), args.contractAddress as string, template);
  const [name, symbol, totalSupply, status, countryCode, identityVerifier, version, metadata] = await Promise.all([
    registry.getName(),
    registry.getSymbol(),
    registry.getTotalSupply(),
    registry.getStatus(),
    registry.getCountryCode(),
    registry.getIdentityVerifier(),
    registry.getVersion(),
    registry.getMetadata(),
  ]);
  const details: Record<string, unknown> = {
    template, name, symbol, totalSupply: fromUnits(totalSupply),
    status: Number(status), statusLabel: STATUS_LABELS[Number(status)] ?? "UNKNOWN",
    countryCode, identityVerifier, metadataVersion: version, metadata,
  };
  switch (template) {
    case "commodity":
      details.isExpired = await registry.isExpired();
      break;
    case "invoice":
      [details.invoiceStatus, details.isOverdue] = await Promise.all([registry.getInvoiceStatus(), registry.isOverdue()]);
      break;
    case "carbon-credit": {
      const [retired, count] = await Promise.all([registry.getTotalRetired(), registry.getTotalRetirements()]);
      details.totalRetired = fromUnits(retired);
      details.totalRetirements = count;
      break;
    }
    case "mining-rights":
      details.isLicenseExpired = await registry.isLicenseExpired();
      break;
  }
  return details;
}

async function handleAssetAction(args: Args) {
  const template = args.template as AssetTemplate;
  const action = args.action as (typeof ASSET_ACTIONS)[number];
  const p = (args.params as Record<string, unknown>) ?? {};
  const need = (key: string) => {
    if (p[key] === undefined || p[key] === "") throw new Error(`asset_action ${action} requires params.${key}`);
    return p[key];
  };
  const registry = new AssetRegistry(adapterFor(args), args.contractAddress as string, template);
  let txHash: string;
  switch (action) {
    case "set_status":                  txHash = await registry.setStatus(Number(need("status")) as AssetStatus); break;
    case "set_identity_verifier":       txHash = await registry.setIdentityVerifier(String(need("verifier"))); break;
    case "pause":                       txHash = await registry.pause(); break;
    case "unpause":                     txHash = await registry.unpause(); break;
    case "mint":                        txHash = await registry.mint(String(need("to")), units(need("amount"))); break;
    case "update_valuation":            txHash = await registry.updateValuation(units(need("valuationUSD"))); break;
    case "update_occupancy_status":     txHash = await registry.updateOccupancyStatus(String(need("status"))); break;
    case "declare_rental_distribution": txHash = await registry.declareRentalDistribution(units(need("amountUSD"))); break;
    case "mark_expired":                txHash = await registry.markExpired(); break;
    case "mark_funded":                 txHash = await registry.markFunded(); break;
    case "mark_repaid":                 txHash = await registry.markRepaid(); break;
    case "mark_defaulted":              txHash = await registry.markDefaulted(String(need("reason"))); break;
    case "retire":
      txHash = await registry.retire(units(need("amount")), String(need("beneficiary")), String(p.note ?? ""));
      break;
    case "renew_license": {
      const expiry = BigInt(Math.floor(Date.now() / 1000)) + BigInt(Number(need("expiryDays"))) * 86_400n;
      txHash = await registry.renewLicense(expiry);
      break;
    }
    case "mark_license_expired":        txHash = await registry.markLicenseExpired(); break;
    case "declare_royalty":             txHash = await registry.declareRoyalty(units(need("extractionValueUSD"))); break;
    default:
      throw new Error(`Unknown asset action: ${action}. Expected one of: ${ASSET_ACTIONS.join(", ")}`);
  }
  return { action, template, txHash };
}

async function handleSetAssetStatus(args: Args) {
  if (isStellar(args)) {
    const txHash = await adapterFor(args).assetSetStatus(args.contractAddress as string, "farmland", Number(args.status) as AssetStatus);
    return { txHash, newStatus: args.status };
  }
  const w = evmWallet(args);
  const contract = new ethers.Contract(args.contractAddress as string, FARMLAND_TOKEN_ABI, w);
  const tx = await contract.setStatus(args.status);
  const receipt = await tx.wait();
  return { txHash: receipt.hash, newStatus: args.status };
}

async function handleListDeployments(args: Args) {
  if (isStellar(args)) {
    const tokens = await adapterFor(args, { factoryAddress: args.factoryAddress as string }, { readOnly: true })
      .getDeployerTokens(args.deployerAddress as string);
    return { deployer: args.deployerAddress, tokens, count: tokens.length };
  }
  const provider = new ethers.JsonRpcProvider(args.rpcUrl);
  const factory  = new ethers.Contract(args.factoryAddress as string, TOKEN_FACTORY_ABI, provider);
  const tokens   = await factory.getDeployerTokens(args.deployerAddress);
  return { deployer: args.deployerAddress, tokens: [...tokens], count: tokens.length };
}

// ─── Multi-token / pool / oracle handlers ────────────────────────────────────

async function handleDeployBatchToken(args: Args) {
  const factory = tokenFactoryFor(args, { multiTokenFactoryAddress: args.multiTokenFactoryAddress as string });
  const result = await factory.deployCommodityBatchToken({
    name: args.name as string,
    countryCode: args.countryCode as string,
    baseURI: args.baseURI as string,
    warehouse: {
      warehouseId: args.warehouseId as string,
      warehouseLocation: args.warehouseLocation as string,
    },
  });
  return { contractAddress: result.contractAddress, txHash: result.txHash };
}

async function handleDeployPoolVault(args: Args) {
  const factory = tokenFactoryFor(args, { multiTokenFactoryAddress: args.multiTokenFactoryAddress as string });
  const result = await factory.deployPoolVault({
    name: args.name as string,
    symbol: args.symbol as string,
    assetId: args.assetId as string,
    countryCode: args.countryCode as string,
    oracle: args.oracle as string | undefined,
    managementFeeBps: args.managementFeeBps as number | undefined,
  });
  return { contractAddress: result.contractAddress, txHash: result.txHash };
}

async function handleBatchRegister(args: Args) {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const txHash = await adapterFor(args).batchRegister(args.contractAddress as string, BigInt(String(args.batchId)), {
    commodityType: args.commodityType as string,
    quantityKg: BigInt(String(args.quantityKg)),
    gradeClassification: args.gradeClassification as string,
    depositDate: now,
    expiryDate: now + BigInt(Number(args.expiryDays ?? 365)) * 86_400n,
    inspectionReportHash: ethers.ZeroHash,
    valuationUSD: units(args.valuationUSD),
    harvestSeason: args.harvestSeason as string,
    originCountry: args.originCountry as string,
  });
  return { txHash, batchId: args.batchId };
}

async function handleBatchMint(args: Args) {
  const txHash = await adapterFor(args).batchMint(
    args.contractAddress as string, BigInt(String(args.batchId)), args.to as string, BigInt(String(args.amount))
  );
  return { txHash, batchId: args.batchId, to: args.to, amount: args.amount };
}

async function handlePoolDeposit(args: Args) {
  const txHash = await adapterFor(args).poolDeposit(args.vaultAddress as string, args.token as string, units(args.amount));
  return { txHash, token: args.token, amount: args.amount };
}

async function handlePoolWithdraw(args: Args) {
  const txHash = await adapterFor(args).poolWithdraw(args.vaultAddress as string, units(args.poolTokenAmount));
  return { txHash, poolTokenAmount: args.poolTokenAmount };
}

async function handleGetPoolStatus(args: Args) {
  const s = await adapterFor(args, {}, { readOnly: true }).poolGetStatus(args.vaultAddress as string);
  return {
    ...s,
    totalSupply: fromUnits(s.totalSupply),
    navPerToken: fromUnits(s.navPerToken),
    totalAUM: fromUnits(s.totalAUM),
  };
}

async function handleOracleSetPrice(args: Args) {
  const txHash = await adapterFor(args).oracleSetPrice(args.oracleAddress as string, args.token as string, units(args.priceUSD));
  return { txHash, token: args.token, priceUSD: args.priceUSD };
}

// ─── Collateral vault (Stellar-only) ─────────────────────────────────────────

function collateralVault(args: Args, readOnly = false) {
  return new CollateralVault(stellarAdapterFor(args, { readOnly }), args.vaultAddress as string);
}

async function handleVaultOpenLoan(args: Args) {
  return collateralVault(args).openLoan(
    args.collateralToken as string, BigInt(String(args.collateralAmount)), BigInt(String(args.borrowAmount))
  );
}

async function handleVaultRepayLoan(args: Args) {
  return { txHash: await collateralVault(args).repayLoan(Number(args.loanId)), loanId: args.loanId };
}

async function handleVaultLiquidate(args: Args) {
  return { txHash: await collateralVault(args).liquidate(Number(args.loanId)), loanId: args.loanId };
}

async function handleGetLoan(args: Args) {
  const vault = collateralVault(args, true);
  if (args.loanId === undefined) {
    const [borrowedToken, oracle, ltvBps, liquidationThresholdBps, paused] = await Promise.all([
      vault.getBorrowedToken(), vault.getOracle(), vault.getLtvBps(), vault.getLiquidationThresholdBps(), vault.isPaused(),
    ]);
    return { borrowedToken, oracle, ltvBps, liquidationThresholdBps, paused };
  }
  const id = Number(args.loanId);
  const [loan, currentLtvBps, liquidatable] = await Promise.all([
    vault.getLoan(id), vault.currentLtvBps(id), vault.isLiquidatable(id),
  ]);
  return { loanId: id, ...loan, currentLtvBps, liquidatable };
}

// ─── Escrow handlers ─────────────────────────────────────────────────────────

async function handleDeployEscrow(args: Args) {
  const factory = tokenFactoryFor(args, { escrowFactoryAddress: args.escrowFactoryAddress as string });
  const milestones = (args.milestones as string[]).map((amount) => ({ amount: units(amount) }));
  const result = await factory.deployEscrow({
    payer: args.payer as string,
    payee: args.payee as string,
    arbiter: args.arbiter as string | undefined,
    token: args.token as string,
    milestones,
    timelockDurationSeconds: args.timelockDurationSeconds as number | undefined,
  });
  return {
    escrowAddress: result.escrowAddress,
    txHash: result.txHash,
    totalAmount: fromUnits(result.totalAmount),
  };
}

function escrowManager(args: Args, readOnly = false) {
  return new EscrowManager(adapterFor(args, {}, { readOnly }), args.escrowAddress as string);
}

const ERC20_APPROVE_ABI = ["function approve(address spender, uint256 amount) returns (bool)"] as const;

async function handleFundEscrow(args: Args) {
  const manager = escrowManager(args);
  const milestones = await manager.getAllMilestones();
  const ids = args.milestoneId !== undefined
    ? [Number(args.milestoneId)]
    : milestones.map((m, i) => (m.funded ? -1 : i)).filter((i) => i >= 0);
  if (ids.length === 0) return { funded: [], message: "Every milestone is already funded" };
  for (const id of ids) {
    if (!milestones[id]) throw new Error(`Milestone ${id} does not exist`);
  }
  const total = ids.reduce((sum, id) => sum + milestones[id].amount, 0n);

  if (!isStellar(args)) {
    // EVM: the escrow pulls via transferFrom, so approve first. (Soroban
    // tokens are authorized inside the fund call itself.)
    const w = evmWallet(args);
    const escrowRead = new ethers.Contract(args.escrowAddress as string, MILESTONE_ESCROW_ABI, w.provider);
    const token = new ethers.Contract(await escrowRead.token(), ERC20_APPROVE_ABI, w);
    await (await token.approve(args.escrowAddress, total)).wait();
  }
  const txHashes: string[] = [];
  for (const id of ids) txHashes.push(await manager.fund(id));
  return { funded: ids, fundedAmount: fromUnits(total), txHashes };
}

async function handleEscrowMilestoneAction(name: string, args: Args) {
  const manager = escrowManager(args);
  const id = Number(args.milestoneId);
  const txHash = await {
    mark_milestone_delivered: () => manager.markDelivered(id),
    approve_milestone: () => manager.approveMilestone(id),
    raise_dispute: () => manager.raiseDispute(id),
    claim_timelock_release: () => manager.claimTimelockRelease(id),
  }[name as "raise_dispute"]();
  return { txHash, milestoneId: id };
}

async function handleResolveDispute(args: Args) {
  const txHash = await escrowManager(args).resolveDispute(Number(args.milestoneId), Boolean(args.releaseToPayee));
  return { txHash, milestoneId: args.milestoneId, releaseToPayee: args.releaseToPayee };
}

async function handleVoteCancelEscrow(args: Args) {
  return { txHash: await escrowManager(args).voteCancel() };
}

async function handleGetEscrowStatus(args: Args) {
  const manager = escrowManager(args, true);
  const [payer, payee, arbiter, token, totalAmount, funded, cancelled, remainingBalance, milestones] = await Promise.all([
    manager.getPayer(),
    manager.getPayee(),
    manager.getArbiter(),
    manager.getToken(),
    manager.getTotalAmount(),
    manager.isFunded(),
    manager.isCancelled(),
    manager.remainingBalance(),
    manager.getAllMilestones(),
  ]);
  const STATUS_LABEL = ["PENDING", "DELIVERED", "DISPUTED", "RELEASED", "REFUNDED"];
  return {
    payer,
    payee,
    arbiter: !arbiter || arbiter === ethers.ZeroAddress ? null : arbiter,
    token,
    totalAmount: fromUnits(totalAmount),
    funded,
    cancelled,
    remainingBalance: fromUnits(remainingBalance),
    milestones: milestones.map((m, id) => ({
      id,
      amount: fromUnits(m.amount),
      funded: m.funded,
      status: STATUS_LABEL[Number(m.status)] ?? "UNKNOWN",
      deliveredAt: m.deliveredAt > 0n ? Number(m.deliveredAt) : null,
    })),
  };
}

// ─── Ramp handlers ───────────────────────────────────────────────────────────

async function handleDeployRampSettlement(args: Args) {
  const factory = tokenFactoryFor(args, { rampSettlementFactoryAddress: args.rampSettlementFactoryAddress as string });
  const result = await factory.deployRampSettlement({ treasury: args.treasury as string });
  return { settlementAddress: result.settlementAddress, txHash: result.txHash };
}

async function handleGetRampQuote(args: Args) {
  const provider = new ManualRampProvider();
  return provider.getQuote({
    direction: args.direction as "on-ramp" | "off-ramp",
    fiatCurrency: args.fiatCurrency as string,
    tokenSymbol: args.tokenSymbol as string,
    countryCode: args.countryCode as string,
    fiatAmount: args.fiatAmount as string | undefined,
    tokenAmount: args.tokenAmount as string | undefined,
  });
}

async function handleInitiateOnramp(args: Args) {
  const provider = new ManualRampProvider();
  return provider.initiateOnRamp({
    fiatAmount: args.fiatAmount as string,
    fiatCurrency: args.fiatCurrency as string,
    tokenSymbol: args.tokenSymbol as string,
    recipientAddress: args.recipientAddress as string,
    countryCode: args.countryCode as string,
  });
}

function rampManager(args: Args, provider = new ManualRampProvider(), readOnly = false) {
  return new RampManager(provider, adapterFor(args, {}, { readOnly }), { settlementAddress: args.settlementAddress as string });
}

async function handleRecordOnrampSettlement(args: Args) {
  const txHash = await rampManager(args).recordOnRampSettlement(
    args.reference as string, args.recipient as string, args.token as string, units(args.amount)
  );
  return { txHash };
}

async function handleInitiateOfframp(args: Args) {
  const rampProvider = new ManualRampProvider();
  const session = await rampProvider.initiateOffRamp({
    tokenAmount:  args.amount as string,
    tokenSymbol:  args.token as string,
    fiatCurrency: args.fiatCurrency as string,
    countryCode:  args.countryCode as string,
    payoutAccount: args.bankCode
      ? { type: "bank", accountNumber: args.accountNumber as string, bankCode: args.bankCode as string }
      : { type: "mobile-money", accountNumber: args.accountNumber as string },
  });

  const amount = units(args.amount);
  if (!isStellar(args)) {
    const w = evmWallet(args);
    const token = new ethers.Contract(args.token as string, ERC20_APPROVE_ABI, w);
    await (await token.approve(args.settlementAddress, amount)).wait();
  }
  const txHash = await rampManager(args, rampProvider).depositOffRamp(session.sessionId, args.token as string, amount);
  return { reference: session.sessionId, txHash };
}

async function handleConfirmOfframpSettlement(args: Args) {
  return { txHash: await rampManager(args).confirmOffRampSettlement(args.reference as string) };
}

async function handleRefundOfframp(args: Args) {
  return { txHash: await rampManager(args).refundOffRamp(args.reference as string) };
}

async function handleGetRampStatus(args: Args) {
  const STATUS_LABEL = ["NONE", "PENDING", "SETTLED", "REFUNDED", "RECORDED"];
  if (isStellar(args)) {
    const ramp = rampManager(args, undefined, true);
    const [offRamp, onRamp] = await Promise.all([
      ramp.getOffRampDeposit(args.reference as string),
      ramp.getOnRampRecord(args.reference as string),
    ]);
    return {
      offRamp: offRamp.status === RampSettlementStatus.NONE ? null : { ...offRamp, amount: fromUnits(offRamp.amount), status: STATUS_LABEL[offRamp.status] },
      onRamp: onRamp.status === RampSettlementStatus.NONE ? null : { ...onRamp, amount: fromUnits(onRamp.amount), status: STATUS_LABEL[onRamp.status] },
    };
  }
  const provider = new ethers.JsonRpcProvider(args.rpcUrl);
  const contract = new ethers.Contract(args.settlementAddress as string, RAMP_SETTLEMENT_ABI, provider);
  const referenceId = ethers.keccak256(ethers.toUtf8Bytes(args.reference as string));

  const [treasury, offRamp, onRamp] = await Promise.all([
    contract.treasury(),
    contract.getOffRamp(referenceId),
    contract.getOnRamp(referenceId),
  ]);

  return {
    treasury,
    offRamp: Number(offRamp.status) === RampSettlementStatus.NONE ? null : {
      depositor: offRamp.depositor,
      token:     offRamp.token,
      amount:    ethers.formatEther(offRamp.amount),
      status:    STATUS_LABEL[Number(offRamp.status)],
    },
    onRamp: Number(onRamp.status) === RampSettlementStatus.NONE ? null : {
      recipient: onRamp.recipient,
      token:     onRamp.token,
      amount:    ethers.formatEther(onRamp.amount),
      status:    STATUS_LABEL[Number(onRamp.status)],
    },
  };
}

// ─── Indexer ─────────────────────────────────────────────────────────────────

async function handleQueryIndexerEvents(args: Args) {
  const client = new IndexerClient(args.indexerUrl as string);
  const events = await client.queryEvents({
    contract: args.contract as string | undefined,
    type: args.type as string | undefined,
    since: args.since as number | undefined,
    limit: args.limit as number | undefined,
  });
  return { count: events.length, events };
}

// ─── Dispatch (exported for tests) ────────────────────────────────────────────

const HANDLERS: Record<string, (args: Args) => unknown> = {
  get_template_fields:        handleGetTemplateFields,
  deploy_token:               handleDeployToken,
  deploy_nft:                 handleDeployNFT,
  mint_tokens:                handleMintTokens,
  transfer_tokens:            handleTransferTokens,
  transfer_nft:               handleTransferNFT,
  get_token_balance:          handleGetTokenBalance,
  get_token_status:           handleGetTokenStatus,
  get_asset_details:          handleGetAssetDetails,
  asset_action:               handleAssetAction,
  set_asset_status:           handleSetAssetStatus,
  list_deployments:           handleListDeployments,
  deploy_batch_token:         handleDeployBatchToken,
  deploy_pool_vault:          handleDeployPoolVault,
  batch_register:             handleBatchRegister,
  batch_mint:                 handleBatchMint,
  pool_deposit:               handlePoolDeposit,
  pool_withdraw:              handlePoolWithdraw,
  get_pool_status:            handleGetPoolStatus,
  oracle_set_price:           handleOracleSetPrice,
  vault_open_loan:            handleVaultOpenLoan,
  vault_repay_loan:           handleVaultRepayLoan,
  vault_liquidate:            handleVaultLiquidate,
  get_loan:                   handleGetLoan,
  deploy_escrow:              handleDeployEscrow,
  fund_escrow:                handleFundEscrow,
  mark_milestone_delivered:   (a) => handleEscrowMilestoneAction("mark_milestone_delivered", a),
  approve_milestone:          (a) => handleEscrowMilestoneAction("approve_milestone", a),
  raise_dispute:              (a) => handleEscrowMilestoneAction("raise_dispute", a),
  claim_timelock_release:     (a) => handleEscrowMilestoneAction("claim_timelock_release", a),
  resolve_dispute:            handleResolveDispute,
  vote_cancel_escrow:         handleVoteCancelEscrow,
  get_escrow_status:          handleGetEscrowStatus,
  deploy_ramp_settlement:     handleDeployRampSettlement,
  get_ramp_quote:             handleGetRampQuote,
  initiate_onramp:            handleInitiateOnramp,
  record_onramp_settlement:   handleRecordOnrampSettlement,
  initiate_offramp:           handleInitiateOfframp,
  confirm_offramp_settlement: handleConfirmOfframpSettlement,
  refund_offramp:             handleRefundOfframp,
  get_ramp_status:            handleGetRampStatus,
  query_indexer_events:       handleQueryIndexerEvents,
};

export async function callTool(name: string, args: Record<string, unknown> = {}) {
  const handler = HANDLERS[name];
  if (!handler) return err(`Unknown tool: ${name}`);
  try {
    return ok(await handler(args as Args));
  } catch (e: any) {
    return err(e?.message ?? String(e));
  }
}

export { TOOLS, HANDLERS };

// ─── Server ──────────────────────────────────────────────────────────────────
// Only start the stdio server when run directly (e.g. `node dist/index.js`),
// not when this module is imported — this lets tests import TOOLS/callTool
// without spinning up a real MCP transport.

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  const server = new Server(
    { name: "@ankarachain/mcp", version: "0.0.1" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    return callTool(name, args as Record<string, unknown>);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
