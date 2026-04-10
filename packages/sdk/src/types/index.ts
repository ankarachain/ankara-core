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

export type AssetTemplate =
  | "farmland"
  | "commodity"
  | "real-estate"
  | "invoice"
  | "carbon-credit"
  | "mining-rights";

// ─── Metadata types ──────────────────────────────────────────────────────────

export interface FarmlandMetadata {
  location: string;
  areaSqMeters: bigint;
  soilType: string;
  irrigationType: string;
  cropHistory: string;
  titleDocumentHash: string;
  valuationUSD: bigint;
  stateRegion: string;
  lastUpdated: bigint;
}

export interface CommodityMetadata {
  commodityType: string;
  quantityKg: bigint;
  gradeClassification: string;
  warehouseId: string;
  warehouseLocation: string;
  depositDate: bigint;
  expiryDate: bigint;
  inspectionReportHash: string;
  valuationUSD: bigint;
  harvestSeason: string;
  lastUpdated: bigint;
}

export interface RealEstateMetadata {
  propertyId: string;
  propertyType: string;       // Residential | Commercial | Industrial | Land
  locationAddress: string;
  totalAreaSqMeters: bigint;
  titleDocumentHash: string;
  valuationUSD: bigint;
  rentalYieldBps: bigint;     // Annual yield in basis points e.g. 600 = 6%
  occupancyStatus: string;    // Vacant | Owner-occupied | Tenanted
  developerAddress: string;
  lastUpdated: bigint;
}

export interface InvoiceMetadata {
  invoiceNumber: string;
  debtorReference: string;
  faceValueUSD: bigint;
  discountRateBps: bigint;
  issuanceDate: bigint;
  dueDate: bigint;
  invoiceDocumentHash: string;
  currency: string;           // ISO 4217 e.g. NGN, GHS, KES, USD
  lastUpdated: bigint;
}

export interface CarbonCreditMetadata {
  creditType: string;          // REDD+ | VCS | Gold Standard | GS4GG | CDM
  verificationBodyRef: string;
  vintageYear: bigint;
  quantityCO2e: bigint;        // In wei (1e18 = 1 tCO2e)
  projectLocation: string;
  projectType: string;         // Forestry | Agriculture | Energy | Waste
  verificationDocHash: string;
  lastUpdated: bigint;
}

export interface MiningRightsMetadata {
  licenseNumber: string;
  mineralType: string;         // Gold | Coltan | Copper | Diamond | Coal | Lithium
  concessionArea: string;
  areaHectares: bigint;
  licenseExpiry: bigint;
  issuingAuthority: string;
  licenseDocumentHash: string;
  royaltyRateBps: bigint;
  lastUpdated: bigint;
}

// ─── Deploy options ──────────────────────────────────────────────────────────

export interface BaseDeployOptions {
  name: string;
  symbol: string;
  assetId: string;
  countryCode: string;
  admin?: string;
  identityVerifier?: string;
}

export interface DeployFarmlandOptions extends BaseDeployOptions {
  metadata: FarmlandMetadata;
}

export interface DeployCommodityOptions extends BaseDeployOptions {
  metadata: CommodityMetadata;
}

export interface DeployRealEstateOptions extends BaseDeployOptions {
  metadata: RealEstateMetadata;
}

export interface DeployInvoiceOptions extends BaseDeployOptions {
  metadata: InvoiceMetadata;
}

export interface DeployCarbonCreditOptions extends BaseDeployOptions {
  metadata: CarbonCreditMetadata;
}

export interface DeployMiningRightsOptions extends BaseDeployOptions {
  metadata: MiningRightsMetadata;
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
