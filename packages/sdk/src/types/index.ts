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

export type NFTAssetTemplate =
  | "farmland-nft"
  | "real-estate-nft"
  | "mining-rights-nft"
  | "commodity-vault-nft";

export type MultiTokenTemplate = "commodity-batch" | "pool-vault";

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

/** Mirrors the on-chain InvoiceToken.InvoiceStatus enum */
export enum InvoiceStatus {
  PENDING   = 0,
  FUNDED    = 1,
  REPAID    = 2,
  DEFAULTED = 3,
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

/** On-chain record of a single carbon credit retirement event */
export interface RetirementRecord {
  retiredBy:      string;   // wallet address
  amount:         bigint;   // wei (1e18 = 1 tCO2e)
  timestamp:      bigint;
  beneficiary:    string;   // entity the offset is on behalf of
  retirementNote: string;   // reason / project reference
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

// ─── NFT Metadata types ──────────────────────────────────────────────────────

export interface FarmlandNFTMetadata {
  location: string;
  areaSqMeters: bigint;
  soilType: string;
  irrigationType: string;
  cropHistory: string;
  titleDocumentHash: string;  // bytes32 hex
  surveyReportHash: string;   // bytes32 hex
  stateRegion: string;
  lastUpdated: bigint;
}

export interface RealEstateNFTMetadata {
  propertyId: string;
  propertyType: string;         // Residential | Commercial | Industrial | Land
  locationAddress: string;
  totalAreaSqMeters: bigint;
  titleDocumentHash: string;    // bytes32 hex
  valuationUSD: bigint;
  rentalYieldBps: bigint;
  developerAddress: string;
  lastUpdated: bigint;
}

export interface MiningRightsNFTMetadata {
  licenseNumber: string;
  mineralType: string;
  concessionArea: string;
  areaHectares: bigint;
  licenseExpiry: bigint;
  issuingAuthority: string;
  licenseDocumentHash: string;  // bytes32 hex
  royaltyRateBps: bigint;
  lastUpdated: bigint;
}

export interface CommodityVaultNFTMetadata {
  warehouseId: string;
  warehouseLocation: string;
  operatorAddress: string;
  commodityType: string;
  quantityKg: bigint;
  gradeClassification: string;
  certificateHash: string;      // bytes32 hex
  depositDate: bigint;
  lastUpdated: bigint;
}

// ─── NFT Deploy options ──────────────────────────────────────────────────────

export interface BaseDeployNFTOptions {
  name: string;
  symbol: string;
  assetId: string;
  countryCode: string;
  admin?: string;
  identityVerifier?: string;
}

export interface DeployFarmlandNFTOptions extends BaseDeployNFTOptions {
  metadata: FarmlandNFTMetadata;
}

export interface DeployRealEstateNFTOptions extends BaseDeployNFTOptions {
  metadata: RealEstateNFTMetadata;
}

export interface DeployMiningRightsNFTOptions extends BaseDeployNFTOptions {
  metadata: MiningRightsNFTMetadata;
}

export interface DeployCommodityVaultNFTOptions extends BaseDeployNFTOptions {
  metadata: CommodityVaultNFTMetadata;
}

// ─── NFT Deploy result ───────────────────────────────────────────────────────

export interface NFTDeployResult {
  nftAddress: string;
  txHash: string;
  assetId: string;
  template: NFTAssetTemplate;
  network: SupportedNetwork;
  deployedAt: number;
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

// ─── Milestone Escrow ────────────────────────────────────────────────────────

/** Mirrors the on-chain MilestoneEscrow.MilestoneStatus enum */
export enum MilestoneStatus {
  PENDING   = 0,
  DELIVERED = 1,
  DISPUTED  = 2,
  RELEASED  = 3,
  REFUNDED  = 4,
}

export interface Milestone {
  amount: bigint;
  descriptionHash: string;
  status: MilestoneStatus;
  deliveredAt: bigint;
}

export interface EscrowMilestoneInput {
  amount: bigint;
  descriptionHash?: string;  // bytes32 hex; defaults to zero hash if omitted
}

export interface DeployEscrowOptions {
  payer: string;
  payee: string;
  token: string;                  // stablecoin address — must be whitelisted on EscrowFactory
  milestones: EscrowMilestoneInput[];
  arbiter?: string;                // defaults to no arbiter (address(0))
  identityVerifier?: string;       // defaults to no KYC gating (address(0))
  timelockDurationSeconds?: number; // defaults to 7 days on-chain when 0/omitted
  admin?: string;                  // defaults to the connected signer
}

export interface EscrowDeployResult {
  escrowAddress: string;
  txHash: string;
  payer: string;
  payee: string;
  token: string;
  totalAmount: bigint;
  network: SupportedNetwork;
  deployedAt: number;
}

// ─── Multi-Token (ERC-1155) Deploy ────────────────────────────────────────────

export interface WarehouseMetadata {
  warehouseId: string;
  warehouseLocation: string;
  operatorAddress?: string;       // defaults to admin/signer
  warehouseLicenseHash?: string;  // bytes32 hex; defaults to zero hash
  certificationExpiry?: bigint;   // unix seconds; defaults to far future if omitted
}

export interface DeployCommodityBatchOptions {
  name: string;
  countryCode: string;
  baseURI: string;
  admin?: string;
  warehouse: WarehouseMetadata;
}

export interface DeployPoolVaultOptions {
  name: string;
  symbol: string;
  assetId: string;
  countryCode: string;
  admin?: string;
  identityVerifier?: string;
  oracle?: string;              // defaults to address(0) — no oracle
  managementFeeBps?: number;    // defaults to 0
}

export interface MultiTokenDeployResult {
  contractAddress: string;
  txHash: string;
  template: MultiTokenTemplate;
  network: SupportedNetwork;
  deployedAt: number;
}

// ─── SDK config ──────────────────────────────────────────────────────────────

export interface AnkaraChainConfig {
  network: SupportedNetwork;
  signer?: Signer;
  provider?: Provider;
  factoryAddress?: string;          // Override default ERC-20 factory address
  nftFactoryAddress?: string;       // Override default NFT factory address
  multiTokenFactoryAddress?: string; // Override default ERC-1155 factory address
  escrowFactoryAddress?: string;    // Override default EscrowFactory address
  rpcUrl?: string;                  // Override default RPC
}
