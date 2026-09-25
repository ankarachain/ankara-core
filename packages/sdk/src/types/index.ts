import type { Signer, Provider } from "ethers";
import type { SignTransaction, SignAuthEntry } from "@stellar/stellar-sdk/contract";

// ─── Chain config ────────────────────────────────────────────────────────────

export type EVMSupportedNetwork =
  | "polygon"
  | "polygon-amoy"
  | "ethereum"
  | "bnb"
  | "celo"
  | "localhost";

export type StellarSupportedNetwork = "stellar" | "stellar-testnet";

export type SupportedNetwork = EVMSupportedNetwork | StellarSupportedNetwork;

export interface EVMNetworkConfig {
  chainFamily: "evm";
  chainId: number;
  name: string;
  rpcUrl: string;
  explorerUrl: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
}

export interface StellarNetworkConfig {
  chainFamily: "stellar";
  /** Stellar network passphrase — identifies which network a signed transaction targets. */
  networkPassphrase: string;
  name: string;
  /** Soroban RPC endpoint (not a Horizon URL). */
  rpcUrl: string;
  explorerUrl: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
}

export type NetworkConfig = EVMNetworkConfig | StellarNetworkConfig;

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
  /** Funded independently per milestone — the payer can pay in installments rather than the whole deal at once. */
  funded: boolean;
}

export interface EscrowMilestoneInput {
  amount: bigint;
  descriptionHash?: string;  // bytes32 hex; defaults to zero hash if omitted
}

/** Basic on-chain metadata for an arbitrary fungible token — not an Ankara asset, just any ERC-20/SEP-41. */
export interface TokenMetadata {
  name: string;
  symbol: string;
  decimals: number;
}

/** One lifecycle event from a deployed escrow's on-chain history, normalized across both chains. */
export type EscrowActivityType =
  | "funded"
  | "delivered"
  | "released"
  | "disputed"
  | "resolved"
  | "refunded"
  | "cancel-vote"
  | "cancelled"
  | "arbiter-changed";

export interface EscrowActivityEvent {
  type: EscrowActivityType;
  /** Present for milestone-scoped events (delivered/released/disputed/resolved/refunded); absent for deal-level events. */
  milestoneId?: number;
  txHash: string;
  /** Unix seconds; 0 if the underlying event didn't carry a resolvable timestamp. */
  timestamp: number;
  data?: Record<string, unknown>;
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

// ─── CommodityBatchToken (ERC-1155 equivalent) — lifecycle ──────────────────

export interface BatchMetadata {
  commodityType: string;
  quantityKg: bigint;
  gradeClassification: string;
  depositDate: bigint;
  expiryDate: bigint;
  inspectionReportHash: string;   // bytes32 hex
  valuationUSD: bigint;
  harvestSeason: string;
  originCountry: string;
}

// ─── PoolVault — lifecycle ───────────────────────────────────────────────────

export interface PoolVaultStatus {
  name: string;
  symbol: string;
  totalSupply: bigint;
  navPerToken: bigint;
  totalAUM: bigint;
  managementFeeBps: number;
  acceptedTokens: string[];
  lastFeeAccrual: bigint;
  oracle: string;   // empty string if unset
}

// ─── On/Off-Ramp: settlement contract (optional on-chain half) ──────────────

/** Mirrors the on-chain RampSettlement.SettlementStatus enum */
export enum RampSettlementStatus {
  NONE     = 0,
  PENDING  = 1,
  SETTLED  = 2,
  REFUNDED = 3,
  RECORDED = 4,
}

export interface OffRampDeposit {
  depositor: string;
  token: string;
  amount: bigint;
  status: RampSettlementStatus;
  initiatedAt: bigint;
}

export interface OnRampRecord {
  recipient: string;
  token: string;
  amount: bigint;
  status: RampSettlementStatus;
  recordedAt: bigint;
}

export interface DeployRampSettlementOptions {
  treasury: string;
  admin?: string;
}

export interface RampSettlementDeployResult {
  settlementAddress: string;
  txHash: string;
  treasury: string;
  network: SupportedNetwork;
  deployedAt: number;
}

// ─── CollateralVault — lifecycle (Stellar-only in v1; see IAdapter) ─────────
//
// A singleton lending pool, not deployed per-relationship like MilestoneEscrow
// — there is no DeployCollateralVaultOptions/CollateralVaultDeployResult pair
// here because the SDK doesn't deploy it (no on-chain factory exists for it,
// same as ManualOracle). It's provisioned once per network via
// `contracts-stellar/scripts/deploy-testnet.sh`; the SDK only operates on an
// already-deployed instance.

/** Mirrors the on-chain CollateralVault.LoanStatus enum */
export enum LoanStatus {
  OPEN       = 0,
  REPAID     = 1,
  LIQUIDATED = 2,
}

export interface Loan {
  borrower: string;
  collateralToken: string;
  collateralAmount: bigint;
  borrowedToken: string;
  borrowedAmount: bigint;
  /** LTV at open time, locked in — doesn't move if the vault's global LTV config changes later. */
  ltvBps: number;
  openedAt: bigint;
  status: LoanStatus;
}

// ─── Indexer — event query + webhook client (talks to a running
// `@ankarachain/indexer` service, not directly to a chain) ─────────────────

export interface IndexedEvent {
  id: string;
  contract: string;
  eventType: string;
  ledger: number;
  txHash: string;
  timestamp: number;
  data: unknown;
}

export interface EventQueryFilter {
  contract?: string;
  type?: string;
  since?: number;
  limit?: number;
}

export interface RegisteredWebhook {
  id: string;
  url: string;
  events: string[];
  /** Present only in the response from `registerWebhook()` — shown once, at creation time. Absent from `listWebhooks()`. */
  secret?: string;
  createdAt: number;
}

// ─── On/Off-Ramp: provider abstraction (off-chain half) ──────────────────────

export type RampDirection = "on-ramp" | "off-ramp";

export enum RampSessionStatus {
  PENDING    = "pending",
  PROCESSING = "processing",
  SETTLED    = "settled",
  FAILED     = "failed",
  REFUNDED   = "refunded",
}

export interface RampQuoteInput {
  direction: RampDirection;
  fiatCurrency: string;    // e.g. "NGN", "KES", "GHS"
  tokenSymbol: string;     // e.g. "USDC", "USDT"
  countryCode: string;     // ISO 3166-1 alpha-2
  fiatAmount?: string;     // provide one of fiatAmount/tokenAmount
  tokenAmount?: string;
}

export interface RampQuote {
  direction: RampDirection;
  fiatCurrency: string;
  fiatAmount: string;
  tokenAmount: string;
  tokenSymbol: string;
  exchangeRate: string;
  feeFiat: string;
  expiresAt: number; // unix seconds
}

export interface RampPayoutAccount {
  type: "bank" | "mobile-money";
  accountNumber: string;
  accountName?: string;
  bankCode?: string;  // for type: "bank"
  provider?: string;  // for type: "mobile-money", e.g. "MTN", "Airtel"
}

export interface InitiateOnRampInput {
  fiatAmount: string;
  fiatCurrency: string;
  tokenSymbol: string;
  recipientAddress: string;
  countryCode: string;
  customerReference?: string;
}

export interface InitiateOffRampInput {
  tokenAmount: string;
  tokenSymbol: string;
  fiatCurrency: string;
  payoutAccount: RampPayoutAccount;
  countryCode: string;
  customerReference?: string;
}

export interface RampSession {
  sessionId: string;
  direction: RampDirection;
  status: RampSessionStatus;
  providerRef: string;
  paymentUrl?: string; // on-ramp only — where the payer completes the fiat payment
  /**
   * Non-interactive flows (SEP-31 direct payments) only: the on-chain
   * payment the sender must make for the anchor to pay out. Present even
   * when the provider already sent it (`paymentTxHash` set).
   */
  paymentInstructions?: RampPaymentInstructions;
  /** Stellar tx hash of the payment to the anchor, when the provider submitted it itself. */
  paymentTxHash?: string;
  createdAt: number;
}

/** Where and how to send the on-chain leg of a direct (SEP-31) payment. */
export interface RampPaymentInstructions {
  destination: string;
  memo?: string;
  memoType?: "text" | "id" | "hash";
  amount: string;
  assetCode: string;
  assetIssuer?: string;
}

/**
 * Pluggable interface for a fiat on-ramp/off-ramp provider (e.g. Yellow Card,
 * Flutterwave, Transak). Implement this against a real provider's API — the
 * SDK ships only ManualRampProvider, a reference implementation for dev/testing.
 */
export interface RampProvider {
  readonly name: string;
  getQuote(input: RampQuoteInput): Promise<RampQuote>;
  initiateOnRamp(input: InitiateOnRampInput): Promise<RampSession>;
  initiateOffRamp(input: InitiateOffRampInput): Promise<RampSession>;
  getStatus(sessionId: string): Promise<RampSessionStatus>;
}

/**
 * Declarative description of which RampProvider to construct — the input to
 * `createRampProvider()` (see providers/createRampProvider.ts). Lets a
 * caller (e.g. a config file, or a dashboard's persisted Settings) select a
 * provider by name plus its credentials, instead of importing and
 * constructing a provider class directly. On-ramp and off-ramp can each
 * have their own independent selection — see RampManager.withProviders().
 */
export type RampProviderSelection =
  | { provider: "manual"; exchangeRates?: Record<string, number>; feeBps?: number }
  | { provider: "stellar-anchor"; homeDomain: string }
  | { provider: "stellar-sep31"; homeDomain: string; senderId: string; autoPay?: boolean; horizonUrl?: string }
  | { provider: "moonpay"; apiKey: string; secretKey: string; sandbox?: boolean };

// ─── SDK config ──────────────────────────────────────────────────────────────

export interface EVMAnkaraChainConfig {
  network: EVMSupportedNetwork;
  signer?: Signer;
  provider?: Provider;
  factoryAddress?: string;              // Override default ERC-20 factory address
  nftFactoryAddress?: string;           // Override default NFT factory address
  multiTokenFactoryAddress?: string;    // Override default ERC-1155 factory address
  escrowFactoryAddress?: string;        // Override default EscrowFactory address
  rampSettlementFactoryAddress?: string; // Override default RampSettlementFactory address
  rpcUrl?: string;                      // Override default RPC
}

/**
 * An external Stellar wallet signer — publicKey plus a `signTransaction` (and
 * optional `signAuthEntry`) matching Freighter's API shape exactly, so a
 * Freighter (or any SEP-43-compatible wallet) object can be passed straight
 * through. Prefer this over `stellarSecretKey` in any browser context — the
 * raw secret seed never has to touch application code.
 */
export interface StellarExternalSigner {
  publicKey: string;
  signTransaction: SignTransaction;
  signAuthEntry?: SignAuthEntry;
}

export interface StellarAnkaraChainConfig {
  network: StellarSupportedNetwork;
  /** Stellar secret seed (starts with "S..."). Not an EVM private key. Server-side/CLI use only — never collect this in a browser UI; use `stellarSigner` there instead. */
  stellarSecretKey?: string;
  /** External wallet signer (e.g. Freighter). Mutually exclusive with `stellarSecretKey` — if both are set, `stellarSecretKey` wins. */
  stellarSigner?: StellarExternalSigner;
  factoryAddress?: string;              // Soroban contract ID (starts with "C...")
  nftFactoryAddress?: string;
  multiTokenFactoryAddress?: string;
  escrowFactoryAddress?: string;
  rampSettlementFactoryAddress?: string;
  rpcUrl?: string;                      // Override default Soroban RPC endpoint
}

/**
 * Discriminated on `network`: an `EVMSupportedNetwork` value narrows this to
 * `EVMAnkaraChainConfig`, a `StellarSupportedNetwork` value narrows it to
 * `StellarAnkaraChainConfig`. `TokenFactory` switches on `network` to decide
 * whether to construct an `EVMAdapter` or a `StellarAdapter`.
 */
export type AnkaraChainConfig = EVMAnkaraChainConfig | StellarAnkaraChainConfig;
