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
  TOKEN_FACTORY_ABI,
  NFT_FACTORY_ABI,
  MULTI_TOKEN_FACTORY_ABI,
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
  const factory = new TokenFactory(args.factoryAddress, w as any);
  const assetIdBytes = ethers.keccak256(ethers.toUtf8Bytes(args.assetId));

  // Build minimal metadata for each template (zeros/empty — user should customise post-deploy)
  const baseArgs = {
    name: args.name,
    symbol: args.symbol,
    assetId: assetIdBytes,
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
  return { contractAddress: result.contractAddress, txHash: result.txHash };
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
  const factory = new ethers.Contract(args.multiTokenFactoryAddress, MULTI_TOKEN_FACTORY_ABI, w);

  const warehouseMeta = {
    warehouseId:          args.warehouseId,
    warehouseLocation:    args.warehouseLocation,
    operatorAddress:      w.address,
    warehouseLicenseHash: ethers.ZeroHash,
    certificationExpiry:  BigInt(9_999_999_999),
  };

  const tx = await factory.deployCommodityBatchToken(
    args.name, args.countryCode, args.baseURI, w.address, warehouseMeta
  );
  const receipt = await tx.wait();

  const iface = new ethers.Interface(MULTI_TOKEN_FACTORY_ABI as readonly string[]);
  let contractAddress = "";
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === "MultiTokenDeployed") { contractAddress = parsed.args.contractAddress; break; }
    } catch {}
  }
  return { contractAddress, txHash: receipt.hash };
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

// ─── Server ──────────────────────────────────────────────────────────────────

const server = new Server(
  { name: "@ankarachain/mcp", version: "0.0.1" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  try {
    switch (name) {
      case "deploy_token":      return ok(await handleDeployToken(args as any));
      case "deploy_nft":        return ok(await handleDeployNFT(args as any));
      case "deploy_batch_token":return ok(await handleDeployBatchToken(args as any));
      case "mint_tokens":       return ok(await handleMintTokens(args as any));
      case "get_token_status":  return ok(await handleGetTokenStatus(args as any));
      case "list_deployments":  return ok(await handleListDeployments(args as any));
      case "set_asset_status":  return ok(await handleSetAssetStatus(args as any));
      default:                  return err(`Unknown tool: ${name}`);
    }
  } catch (e: any) {
    return err(e.message ?? String(e));
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
