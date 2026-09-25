/**
 * @ankarachain/sdk
 * Open-source RWA tokenization infrastructure
 * by PIE Drops Studio — piedrops.com
 */

// Core classes
export { TokenFactory }    from "./core/TokenFactory";
export { AssetRegistry }   from "./core/AssetRegistry";
export { EscrowManager }   from "./core/EscrowManager";
export { RampManager }     from "./core/RampManager";
export { CollateralVault } from "./core/CollateralVault";
export { IndexerClient }   from "./core/IndexerClient";
// RWA income + liquidity (Stellar-only): pro-rata revenue distribution, RFQ/OTC market
export { RevenueDistributor } from "./core/RevenueDistributor";
export { RfqMarket }          from "./core/RfqMarket";
export type {
  TitleFlags, CustodyEntry, RevenueDistribution, RfqIntent, RfqQuote, RfqIntentStatus, RfqQuoteStatus, PostIntentInput,
} from "./types/rwa";

// Providers (reference implementations — swap in a real provider adapter for production)
export { ManualRampProvider } from "./providers/ManualRampProvider";
export type { ManualRampProviderOptions } from "./providers/ManualRampProvider";
export { StellarAnchorProvider } from "./providers/StellarAnchorProvider";
export type { StellarAnchorProviderOptions } from "./providers/StellarAnchorProvider";

// Adapters (advanced use)
export { EVMAdapter }      from "./adapters/evm";
export { StellarAdapter }  from "./adapters/stellar";
export type { IAdapter }   from "./adapters/IAdapter";

// Types
export type {
  AnkaraChainConfig,
  EVMAnkaraChainConfig,
  StellarAnkaraChainConfig,
  StellarExternalSigner,
  SupportedNetwork,
  EVMSupportedNetwork,
  StellarSupportedNetwork,
  EVMNetworkConfig,
  StellarNetworkConfig,
  AssetTemplate,
  NFTAssetTemplate,
  DeployFarmlandOptions,
  DeployCommodityOptions,
  DeployRealEstateOptions,
  DeployInvoiceOptions,
  DeployCarbonCreditOptions,
  DeployMiningRightsOptions,
  DeployResult,
  FarmlandMetadata,
  CommodityMetadata,
  RealEstateMetadata,
  InvoiceMetadata,
  CarbonCreditMetadata,
  MiningRightsMetadata,
  NetworkConfig,
  // NFT types
  FarmlandNFTMetadata,
  RealEstateNFTMetadata,
  MiningRightsNFTMetadata,
  CommodityVaultNFTMetadata,
  BaseDeployNFTOptions,
  DeployFarmlandNFTOptions,
  DeployRealEstateNFTOptions,
  DeployMiningRightsNFTOptions,
  DeployCommodityVaultNFTOptions,
  NFTDeployResult,
  // Escrow types
  DeployEscrowOptions,
  EscrowDeployResult,
  EscrowMilestoneInput,
  Milestone,
  EscrowActivityType,
  EscrowActivityEvent,
  // Generic token metadata
  TokenMetadata,
  // Multi-token types
  MultiTokenTemplate,
  WarehouseMetadata,
  DeployCommodityBatchOptions,
  DeployPoolVaultOptions,
  MultiTokenDeployResult,
  BatchMetadata,
  PoolVaultStatus,
  // Ramp types (on-chain settlement)
  OffRampDeposit,
  OnRampRecord,
  DeployRampSettlementOptions,
  RampSettlementDeployResult,
  // CollateralVault types
  Loan,
  // Indexer types
  IndexedEvent,
  EventQueryFilter,
  RegisteredWebhook,
  // Ramp types (off-chain provider)
  RampDirection,
  RampQuoteInput,
  RampQuote,
  RampPayoutAccount,
  InitiateOnRampInput,
  InitiateOffRampInput,
  RampSession,
  RampProvider,
  RampProviderSelection,
} from "./types";

export { AssetStatus, InvoiceStatus, MilestoneStatus, RampSettlementStatus, RampSessionStatus, LoanStatus } from "./types";
export type { RetirementRecord } from "./types";

// Utilities
export { getNetwork, NETWORKS } from "./utils/networks";
export {
  TOKEN_FACTORY_ABI,
  FARMLAND_TOKEN_ABI,
  COMMODITY_TOKEN_ABI,
  REAL_ESTATE_TOKEN_ABI,
  INVOICE_TOKEN_ABI,
  CARBON_CREDIT_TOKEN_ABI,
  MINING_RIGHTS_TOKEN_ABI,
  ERC20_METADATA_ABI,
  WHITELIST_VERIFIER_ABI,
  // NFT ABIs
  NFT_FACTORY_ABI,
  FARMLAND_NFT_ABI,
  REAL_ESTATE_NFT_ABI,
  MINING_RIGHTS_NFT_ABI,
  COMMODITY_VAULT_NFT_ABI,
  // Multi-token ABIs
  MULTI_TOKEN_FACTORY_ABI,
  COMMODITY_BATCH_TOKEN_ABI,
  POOL_VAULT_ABI,
  MANUAL_ORACLE_ABI,
  // Escrow ABIs
  ESCROW_FACTORY_ABI,
  MILESTONE_ESCROW_ABI,
  // Ramp settlement ABIs
  RAMP_SETTLEMENT_FACTORY_ABI,
  RAMP_SETTLEMENT_ABI,
} from "./utils/abis";
