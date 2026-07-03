/**
 * @ankarachain/mcp
 * Model Context Protocol server for Ankara Chain — deploy and manage RWA tokens via AI assistants.
 */

import { Server }              from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ethers } from "ethers";
import {
  TokenFactory,
  EVMAdapter,
  EscrowManager,
  TOKEN_FACTORY_ABI,
  NFT_FACTORY_ABI,
  MILESTONE_ESCROW_ABI,
  FARMLAND_TOKEN_ABI,
} from "@ankarachain/sdk";

// ─── Helpers ────────────────────────────────────────────────────────────────

function wallet(rpcUrl: string, privateKey: string) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  return new ethers.Wallet(privateKey, provider);
}

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function err(message: string) {
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

// ─── Tool definitions ────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "deploy_token",
    description: "Deploy an ERC-20 RWA token (farmland, commodity, real-estate, invoice, carbon-credit, mining-rights) via the Ankara Chain TokenFactory.",
    inputSchema: {
      type: "object",
      properties: {
        template:       { type: "string", enum: ["farmland", "commodity", "real-estate", "invoice", "carbon-credit", "mining-rights"] },
        name:           { type: "string", description: "Token name" },
        symbol:         { type: "string", description: "Token symbol (3-5 chars)" },
        assetId:        { type: "string", description: "Unique asset identifier string" },
        countryCode:    { type: "string", description: "ISO 3166-1 alpha-2 country code" },
        rpcUrl:         { type: "string", description: "JSON-RPC endpoint URL" },
        privateKey:     { type: "string", description: "Deployer private key (0x-prefixed)" },
        factoryAddress: { type: "string", description: "Deployed TokenFactory contract address" },
      },
      required: ["template", "name", "symbol", "assetId", "countryCode", "rpcUrl", "privateKey", "factoryAddress"],
    },
  },
  {
    name: "deploy_nft",
    description: "Deploy an ERC-721 NFT asset record contract (farmland-nft, real-estate-nft, mining-rights-nft, commodity-vault-nft) via the Ankara Chain NFTFactory.",
    inputSchema: {
      type: "object",
      properties: {
        template:          { type: "string", enum: ["farmland-nft", "real-estate-nft", "mining-rights-nft", "commodity-vault-nft"] },
        name:              { type: "string" },
        symbol:            { type: "string" },
        assetId:           { type: "string" },
        countryCode:       { type: "string" },
        rpcUrl:            { type: "string" },
        privateKey:        { type: "string" },
        nftFactoryAddress: { type: "string", description: "Deployed NFTFactory contract address" },
      },
      required: ["template", "name", "symbol", "assetId", "countryCode", "rpcUrl", "privateKey", "nftFactoryAddress"],
    },
  },
  {
    name: "deploy_batch_token",
    description: "Deploy a CommodityBatchToken (ERC-1155 warehouse receipt) via the Ankara Chain MultiTokenFactory.",
    inputSchema: {
      type: "object",
      properties: {
        name:                    { type: "string", description: "Warehouse contract name" },
        countryCode:             { type: "string" },
        baseURI:                 { type: "string", description: "Base IPFS URI for token metadata" },
        warehouseId:             { type: "string" },
        warehouseLocation:       { type: "string" },
        rpcUrl:                  { type: "string" },
        privateKey:              { type: "string" },
        multiTokenFactoryAddress: { type: "string", description: "Deployed MultiTokenFactory contract address" },
      },
      required: ["name", "countryCode", "baseURI", "warehouseId", "warehouseLocation", "rpcUrl", "privateKey", "multiTokenFactoryAddress"],
    },
  },
  {
    name: "deploy_pool_vault",
    description: "Deploy a PoolVault (multi-asset ERC-20 fund) via the Ankara Chain MultiTokenFactory.",
    inputSchema: {
      type: "object",
      properties: {
        name:                    { type: "string" },
        symbol:                  { type: "string" },
        assetId:                 { type: "string", description: "Unique asset identifier string" },
        countryCode:             { type: "string" },
        oracle:                  { type: "string", description: "ManualOracle contract address (optional)" },
        managementFeeBps:        { type: "number", description: "Annual management fee in basis points (default 0)" },
        rpcUrl:                  { type: "string" },
        privateKey:              { type: "string" },
        multiTokenFactoryAddress: { type: "string", description: "Deployed MultiTokenFactory contract address" },
      },
      required: ["name", "symbol", "assetId", "countryCode", "rpcUrl", "privateKey", "multiTokenFactoryAddress"],
    },
  },
  {
    name: "deploy_escrow",
    description: "Deploy a MilestoneEscrow for tranche-based diaspora payments via the Ankara Chain EscrowFactory.",
    inputSchema: {
      type: "object",
      properties: {
        payer:                  { type: "string", description: "Payer address (funds the escrow)" },
        payee:                  { type: "string", description: "Payee address (receives released funds)" },
        arbiter:                { type: "string", description: "Optional arbiter address for dispute resolution" },
        token:                  { type: "string", description: "Stablecoin address — must be whitelisted on the EscrowFactory" },
        milestones: {
          type: "array",
          description: "Ordered list of milestone amounts (in token units, e.g. '100')",
          items: { type: "string" },
        },
        timelockDurationSeconds: { type: "number", description: "Seconds before a delivered milestone can be force-released (default 7 days)" },
        rpcUrl:                 { type: "string" },
        privateKey:             { type: "string" },
        escrowFactoryAddress:   { type: "string", description: "Deployed EscrowFactory contract address" },
      },
      required: ["payer", "payee", "token", "milestones", "rpcUrl", "privateKey", "escrowFactoryAddress"],
    },
  },
  {
    name: "fund_escrow",
    description: "Approve and deposit the full agreed amount into a MilestoneEscrow. Payer only.",
    inputSchema: {
      type: "object",
      properties: {
        escrowAddress: { type: "string" },
        rpcUrl:        { type: "string" },
        privateKey:    { type: "string" },
      },
      required: ["escrowAddress", "rpcUrl", "privateKey"],
    },
  },
  {
    name: "mark_milestone_delivered",
    description: "Mark a milestone as delivered on a MilestoneEscrow. Payee only.",
    inputSchema: {
      type: "object",
      properties: {
        escrowAddress: { type: "string" },
        milestoneId:   { type: "number" },
        rpcUrl:        { type: "string" },
        privateKey:    { type: "string" },
      },
      required: ["escrowAddress", "milestoneId", "rpcUrl", "privateKey"],
    },
  },
  {
    name: "approve_milestone",
    description: "Approve a delivered milestone, releasing funds to the payee. Payer only.",
    inputSchema: {
      type: "object",
      properties: {
        escrowAddress: { type: "string" },
        milestoneId:   { type: "number" },
        rpcUrl:        { type: "string" },
        privateKey:    { type: "string" },
      },
      required: ["escrowAddress", "milestoneId", "rpcUrl", "privateKey"],
    },
  },
  {
    name: "raise_dispute",
    description: "Raise a dispute on a delivered milestone. Payer or payee only.",
    inputSchema: {
      type: "object",
      properties: {
        escrowAddress: { type: "string" },
        milestoneId:   { type: "number" },
        rpcUrl:        { type: "string" },
        privateKey:    { type: "string" },
      },
      required: ["escrowAddress", "milestoneId", "rpcUrl", "privateKey"],
    },
  },
  {
    name: "resolve_dispute",
    description: "Resolve a disputed milestone. Arbiter only.",
    inputSchema: {
      type: "object",
      properties: {
        escrowAddress:  { type: "string" },
        milestoneId:    { type: "number" },
        releaseToPayee: { type: "boolean", description: "true = release funds to payee, false = refund to payer" },
        rpcUrl:         { type: "string" },
        privateKey:     { type: "string" },
      },
      required: ["escrowAddress", "milestoneId", "releaseToPayee", "rpcUrl", "privateKey"],
    },
  },
  {
    name: "claim_timelock_release",
    description: "Force-release a delivered milestone after the timelock has elapsed with no dispute raised. Callable by anyone.",
    inputSchema: {
      type: "object",
      properties: {
        escrowAddress: { type: "string" },
        milestoneId:   { type: "number" },
        rpcUrl:        { type: "string" },
        privateKey:    { type: "string" },
      },
      required: ["escrowAddress", "milestoneId", "rpcUrl", "privateKey"],
    },
  },
  {
    name: "get_escrow_status",
    description: "Read status, balances, and milestones for a MilestoneEscrow (read-only, no private key required).",
    inputSchema: {
      type: "object",
      properties: {
        escrowAddress: { type: "string" },
        rpcUrl:        { type: "string" },
      },
      required: ["escrowAddress", "rpcUrl"],
    },
  },
  {
    name: "mint_tokens",
    description: "Mint ERC-20 RWA tokens to a recipient address.",
    inputSchema: {
      type: "object",
      properties: {
        contractAddress: { type: "string" },
        to:              { type: "string", description: "Recipient wallet address" },
        amount:          { type: "string", description: "Amount to mint (in ether units, e.g. '100')" },
        rpcUrl:          { type: "string" },
        privateKey:      { type: "string" },
      },
      required: ["contractAddress", "to", "amount", "rpcUrl", "privateKey"],
    },
  },
  {
    name: "get_token_status",
    description: "Get name, symbol, total supply, and asset status of an Ankara Chain token.",
    inputSchema: {
      type: "object",
      properties: {
        contractAddress: { type: "string" },
        rpcUrl:          { type: "string" },
      },
      required: ["contractAddress", "rpcUrl"],
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
        rpcUrl:          { type: "string" },
      },
      required: ["factoryAddress", "deployerAddress", "rpcUrl"],
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
        rpcUrl:          { type: "string" },
        privateKey:      { type: "string" },
      },
      required: ["contractAddress", "status", "rpcUrl", "privateKey"],
    },
  },
];

// ─── Tool handlers ───────────────────────────────────────────────────────────

async function handleDeployToken(args: Record<string, string>) {
  const w = wallet(args.rpcUrl, args.privateKey);
  const factory = new TokenFactory({
    network: "localhost",
    signer: w,
    provider: w.provider as any,
    factoryAddress: args.factoryAddress,
  });

  // Build minimal metadata for each template (zeros/empty — user should customise post-deploy)
  const baseArgs = {
    name: args.name,
    symbol: args.symbol,
    assetId: args.assetId,
    countryCode: args.countryCode,
    admin: w.address,
    verifier: ethers.ZeroAddress,
  };

  let result: any;
  switch (args.template) {
    case "farmland":
      result = await (factory as any).deployFarmland({
        ...baseArgs,
        metadata: {
          location: "", areaSqMeters: 0n, soilType: "", irrigationType: "",
          cropHistory: "", titleDocumentHash: ethers.ZeroHash,
          valuationUSD: 0n, stateRegion: "",
          lastUpdated: BigInt(Math.floor(Date.now() / 1000)),
        },
      });
      break;
    default:
      throw new Error(`Unsupported template: ${args.template}. Use the CLI for full metadata prompts.`);
  }
  return { contractAddress: result.tokenAddress, txHash: result.txHash };
}

async function handleDeployNFT(args: Record<string, string>) {
  const w = wallet(args.rpcUrl, args.privateKey);
  const factory = new ethers.Contract(args.nftFactoryAddress, NFT_FACTORY_ABI, w);
  const assetIdBytes = ethers.keccak256(ethers.toUtf8Bytes(args.assetId));

  type DeployFn = "deployFarmlandNFT" | "deployRealEstateNFT" | "deployMiningRightsNFT" | "deployCommodityVaultNFT";
  const fnMap: Record<string, DeployFn> = {
    "farmland-nft":       "deployFarmlandNFT",
    "real-estate-nft":    "deployRealEstateNFT",
    "mining-rights-nft":  "deployMiningRightsNFT",
    "commodity-vault-nft":"deployCommodityVaultNFT",
  };
  const fn = fnMap[args.template];
  if (!fn) throw new Error(`Unknown NFT template: ${args.template}`);

  const tx = await factory[fn](args.name, args.symbol, assetIdBytes, args.countryCode, w.address, ethers.ZeroAddress);
  const receipt = await tx.wait();

  const iface = new ethers.Interface(NFT_FACTORY_ABI as readonly string[]);
  let contractAddress = "";
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === "NFTDeployed") { contractAddress = parsed.args.contractAddress; break; }
    } catch {}
  }
  return { contractAddress, txHash: receipt.hash };
}

async function handleDeployBatchToken(args: Record<string, string>) {
  const w = wallet(args.rpcUrl, args.privateKey);
  const factory = new TokenFactory({
    network: "localhost",
    signer: w,
    provider: w.provider as any,
    multiTokenFactoryAddress: args.multiTokenFactoryAddress,
  });

  const result = await factory.deployCommodityBatchToken({
    name: args.name,
    countryCode: args.countryCode,
    baseURI: args.baseURI,
    warehouse: {
      warehouseId: args.warehouseId,
      warehouseLocation: args.warehouseLocation,
    },
  });
  return { contractAddress: result.contractAddress, txHash: result.txHash };
}

async function handleDeployPoolVault(args: Record<string, unknown>) {
  const w = wallet(args.rpcUrl as string, args.privateKey as string);
  const factory = new TokenFactory({
    network: "localhost",
    signer: w,
    provider: w.provider as any,
    multiTokenFactoryAddress: args.multiTokenFactoryAddress as string,
  });

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

async function handleDeployEscrow(args: Record<string, unknown>) {
  const w = wallet(args.rpcUrl as string, args.privateKey as string);
  const factory = new TokenFactory({
    network: "localhost",
    signer: w,
    provider: w.provider as any,
    escrowFactoryAddress: args.escrowFactoryAddress as string,
  });

  const milestones = (args.milestones as string[]).map((amount) => ({
    amount: ethers.parseEther(amount),
  }));

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
    totalAmount: ethers.formatEther(result.totalAmount),
  };
}

function escrowManager(rpcUrl: string, privateKey: string, escrowAddress: string) {
  const w = wallet(rpcUrl, privateKey);
  const adapter = new EVMAdapter("localhost", w.provider!, w);
  return new EscrowManager(adapter, escrowAddress);
}

const ERC20_APPROVE_ABI = ["function approve(address spender, uint256 amount) returns (bool)"] as const;

async function handleFundEscrow(args: Record<string, string>) {
  const w = wallet(args.rpcUrl, args.privateKey);
  const escrowRead = new ethers.Contract(args.escrowAddress, MILESTONE_ESCROW_ABI, w.provider);
  const [tokenAddress, totalAmount] = await Promise.all([
    escrowRead.token(),
    escrowRead.totalAmount(),
  ]);

  const token = new ethers.Contract(tokenAddress, ERC20_APPROVE_ABI, w);
  const approveTx = await token.approve(args.escrowAddress, totalAmount);
  await approveTx.wait();

  const manager = escrowManager(args.rpcUrl, args.privateKey, args.escrowAddress);
  const txHash = await manager.fund();
  return { txHash, fundedAmount: ethers.formatEther(totalAmount) };
}

async function handleMarkMilestoneDelivered(args: Record<string, unknown>) {
  const manager = escrowManager(args.rpcUrl as string, args.privateKey as string, args.escrowAddress as string);
  const txHash = await manager.markDelivered(args.milestoneId as number);
  return { txHash, milestoneId: args.milestoneId };
}

async function handleApproveMilestone(args: Record<string, unknown>) {
  const manager = escrowManager(args.rpcUrl as string, args.privateKey as string, args.escrowAddress as string);
  const txHash = await manager.approveMilestone(args.milestoneId as number);
  return { txHash, milestoneId: args.milestoneId };
}

async function handleRaiseDispute(args: Record<string, unknown>) {
  const manager = escrowManager(args.rpcUrl as string, args.privateKey as string, args.escrowAddress as string);
  const txHash = await manager.raiseDispute(args.milestoneId as number);
  return { txHash, milestoneId: args.milestoneId };
}

async function handleResolveDispute(args: Record<string, unknown>) {
  const manager = escrowManager(args.rpcUrl as string, args.privateKey as string, args.escrowAddress as string);
  const txHash = await manager.resolveDispute(args.milestoneId as number, args.releaseToPayee as boolean);
  return { txHash, milestoneId: args.milestoneId, releaseToPayee: args.releaseToPayee };
}

async function handleClaimTimelockRelease(args: Record<string, unknown>) {
  const manager = escrowManager(args.rpcUrl as string, args.privateKey as string, args.escrowAddress as string);
  const txHash = await manager.claimTimelockRelease(args.milestoneId as number);
  return { txHash, milestoneId: args.milestoneId };
}

async function handleGetEscrowStatus(args: Record<string, string>) {
  const provider = new ethers.JsonRpcProvider(args.rpcUrl);
  const escrow = new ethers.Contract(args.escrowAddress, MILESTONE_ESCROW_ABI, provider);

  const [payer, payee, arbiter, token, totalAmount, funded, cancelled, remainingBalance, milestoneCount] =
    await Promise.all([
      escrow.payer(),
      escrow.payee(),
      escrow.arbiter(),
      escrow.token(),
      escrow.totalAmount(),
      escrow.funded(),
      escrow.cancelled(),
      escrow.remainingBalance(),
      escrow.milestoneCount(),
    ]);

  const STATUS_LABEL = ["PENDING", "DELIVERED", "DISPUTED", "RELEASED", "REFUNDED"];
  const milestones = [];
  for (let i = 0; i < Number(milestoneCount); i++) {
    const m = await escrow.getMilestone(i);
    milestones.push({
      id: i,
      amount: ethers.formatEther(m.amount),
      status: STATUS_LABEL[Number(m.status)] ?? "UNKNOWN",
      deliveredAt: m.deliveredAt > 0n ? Number(m.deliveredAt) : null,
    });
  }

  return {
    payer,
    payee,
    arbiter: arbiter === ethers.ZeroAddress ? null : arbiter,
    token,
    totalAmount: ethers.formatEther(totalAmount),
    funded,
    cancelled,
    remainingBalance: ethers.formatEther(remainingBalance),
    milestones,
  };
}

async function handleMintTokens(args: Record<string, string>) {
  const w = wallet(args.rpcUrl, args.privateKey);
  const contract = new ethers.Contract(args.contractAddress, FARMLAND_TOKEN_ABI, w);
  const amountWei = ethers.parseEther(args.amount);
  const tx = await contract.mint(args.to, amountWei);
  const receipt = await tx.wait();
  return { txHash: receipt.hash, to: args.to, amount: args.amount };
}

async function handleGetTokenStatus(args: Record<string, string>) {
  const provider = new ethers.JsonRpcProvider(args.rpcUrl);
  const contract = new ethers.Contract(args.contractAddress, FARMLAND_TOKEN_ABI, provider);
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
    statusLabel: ["DRAFT", "ACTIVE", "SUSPENDED", "REDEEMED", "EXPIRED"][Number(status)] ?? "UNKNOWN",
  };
}

async function handleListDeployments(args: Record<string, string>) {
  const provider = new ethers.JsonRpcProvider(args.rpcUrl);
  const factory  = new ethers.Contract(args.factoryAddress, TOKEN_FACTORY_ABI, provider);
  const tokens   = await factory.getDeployerTokens(args.deployerAddress);
  return { deployer: args.deployerAddress, tokens: [...tokens], count: tokens.length };
}

async function handleSetAssetStatus(args: Record<string, unknown>) {
  const w = wallet(args.rpcUrl as string, args.privateKey as string);
  const contract = new ethers.Contract(args.contractAddress as string, FARMLAND_TOKEN_ABI, w);
  const tx = await contract.setStatus(args.status);
  const receipt = await tx.wait();
  return { txHash: receipt.hash, newStatus: args.status };
}

// ─── Dispatch (exported for tests) ────────────────────────────────────────────

export async function callTool(name: string, args: Record<string, unknown> = {}) {
  try {
    switch (name) {
      case "deploy_token":              return ok(await handleDeployToken(args as any));
      case "deploy_nft":                return ok(await handleDeployNFT(args as any));
      case "deploy_batch_token":        return ok(await handleDeployBatchToken(args as any));
      case "deploy_pool_vault":         return ok(await handleDeployPoolVault(args as any));
      case "deploy_escrow":             return ok(await handleDeployEscrow(args as any));
      case "fund_escrow":               return ok(await handleFundEscrow(args as any));
      case "mark_milestone_delivered":  return ok(await handleMarkMilestoneDelivered(args as any));
      case "approve_milestone":         return ok(await handleApproveMilestone(args as any));
      case "raise_dispute":             return ok(await handleRaiseDispute(args as any));
      case "resolve_dispute":           return ok(await handleResolveDispute(args as any));
      case "claim_timelock_release":    return ok(await handleClaimTimelockRelease(args as any));
      case "get_escrow_status":         return ok(await handleGetEscrowStatus(args as any));
      case "mint_tokens":               return ok(await handleMintTokens(args as any));
      case "get_token_status":          return ok(await handleGetTokenStatus(args as any));
      case "list_deployments":          return ok(await handleListDeployments(args as any));
      case "set_asset_status":          return ok(await handleSetAssetStatus(args as any));
      default:                          return err(`Unknown tool: ${name}`);
    }
  } catch (e: any) {
    return err(e.message ?? String(e));
  }
}

export { TOOLS };

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
