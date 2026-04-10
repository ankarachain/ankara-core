import type { Signer, Provider } from "ethers";

// ─── Chain config ────────────────────────────────────────────────────────────

export type SupportedNetwork =
  | "polygon"
  | "polygon-amoy"
  | "ethereum"
  | "bnb"
  | "celo"
  | "localhost";

export interface NetworkConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  explorerUrl: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
}

// ─── Asset status ────────────────────────────────────────────────────────────

export enum AssetStatus {
  DRAFT     = 0,
  ACTIVE    = 1,
  SUSPENDED = 2,
  REDEEMED  = 3,
  EXPIRED   = 4,
}

// ─── Asset templates ─────────────────────────────────────────────────────────

export type AssetTemplate = "farmland" | "commodity";

// ─── Metadata types ──────────────────────────────────────────────────────────

export interface FarmlandMetadata {
  location: string;         // GPS decimal degrees or cadastral ref
  areaSqMeters: bigint;     // Land area in square metres
  soilType: string;         // loam | clay | sandy | silt | peaty
  irrigationType: string;   // none | rain-fed | drip | canal | borehole
  cropHistory: string;      // Last 3 seasons e.g. "maize,sorghum,fallow"
  titleDocumentHash: string;// IPFS CID or bytes32 hex string
  valuationUSD: bigint;     // In wei (18 decimals)
  stateRegion: string;      // State or province
  lastUpdated: bigint;      // Unix timestamp
}

export interface CommodityMetadata {
  commodityType: string;       // cocoa|coffee|maize|cotton|soybean|palm-oil
  quantityKg: bigint;
  gradeClassification: string; // e.g. "Grade A", "FAQ", "GC1"
  warehouseId: string;
  warehouseLocation: string;
  depositDate: bigint;         // Unix timestamp
  expiryDate: bigint;          // Unix timestamp
  inspectionReportHash: string;// IPFS CID
  valuationUSD: bigint;
  harvestSeason: string;       // e.g. "2025/2026"
  lastUpdated: bigint;
}

// ─── Deploy options ──────────────────────────────────────────────────────────

export interface BaseDeployOptions {
  name: string;
  symbol: string;
  assetId: string;          // Human-readable ID — SDK converts to bytes32
  countryCode: string;      // ISO 3166-1 alpha-2 e.g. "NG"
  admin?: string;           // Defaults to signer address
  identityVerifier?: string;// address(0) = no KYC. Defaults to address(0)
}

export interface DeployFarmlandOptions extends BaseDeployOptions {
  metadata: FarmlandMetadata;
}

export interface DeployCommodityOptions extends BaseDeployOptions {
  metadata: CommodityMetadata;
}

// ─── Deploy result ───────────────────────────────────────────────────────────

export interface DeployResult {
  tokenAddress: string;
  txHash: string;
  assetId: string;
  template: AssetTemplate;
  network: SupportedNetwork;
  deployedAt: number;
}

// ─── SDK config ──────────────────────────────────────────────────────────────

export interface AnkaraChainConfig {
  network: SupportedNetwork;
  signer?: Signer;
  provider?: Provider;
  factoryAddress?: string;  // Override default factory address
  rpcUrl?: string;          // Override default RPC
}
