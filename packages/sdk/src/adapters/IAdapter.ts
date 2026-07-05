import type {
  SupportedNetwork,
  DeployFarmlandOptions,
  DeployCommodityOptions,
  DeployRealEstateOptions,
  DeployInvoiceOptions,
  DeployCarbonCreditOptions,
  DeployMiningRightsOptions,
  DeployResult,
  DeployFarmlandNFTOptions,
  DeployRealEstateNFTOptions,
  DeployMiningRightsNFTOptions,
  DeployCommodityVaultNFTOptions,
  NFTDeployResult,
  DeployEscrowOptions,
  EscrowDeployResult,
  DeployCommodityBatchOptions,
  DeployPoolVaultOptions,
  MultiTokenDeployResult,
  DeployRampSettlementOptions,
  RampSettlementDeployResult,
  Milestone,
  EscrowActivityEvent,
  TokenMetadata,
  OffRampDeposit,
  OnRampRecord,
  AssetTemplate,
  NFTAssetTemplate,
  AssetStatus,
  InvoiceStatus,
  FarmlandMetadata,
  CommodityMetadata,
  RealEstateMetadata,
  InvoiceMetadata,
  CarbonCreditMetadata,
  MiningRightsMetadata,
  RetirementRecord,
  BatchMetadata,
  PoolVaultStatus,
} from "../types";

/** Any of the 6 fungible template metadata shapes — which one comes back from `assetGetMetadata` depends on the `template` argument passed in. */
export type AnyAssetMetadata =
  | FarmlandMetadata
  | CommodityMetadata
  | RealEstateMetadata
  | InvoiceMetadata
  | CarbonCreditMetadata
  | MiningRightsMetadata;

/**
 * Chain-agnostic adapter interface — every operation `TokenFactory`,
 * `EscrowManager`, `RampManager`, and `AssetRegistry` need, regardless of
 * which chain they're talking to. `EVMAdapter` and `StellarAdapter` both
 * implement this in full, so all four classes route between them
 * transparently based on `AnkaraChainConfig.network`.
 *
 * Deliberately does NOT include the raw contract-accessor methods
 * (`farmlandToken()`, `milestoneEscrow()`, etc.) — those return a
 * chain-specific handle (`ethers.Contract` vs. a Soroban `contract.Client`)
 * that can't be given a single shared type without erasing the very type
 * safety those accessors exist to provide. Everything a caller needs to
 * *do* to a deployed contract (fund an escrow, confirm a ramp settlement,
 * read a milestone) is instead its own named method here.
 *
 * The generic `assetXxx` methods (name/symbol/status/mint/pause/etc., which
 * apply identically across all 6 fungible templates) take an explicit
 * `template` argument so each adapter knows which on-chain ABI/contract-spec
 * to address the call against — the deployed contract's address alone
 * doesn't carry that information. Methods that only ever apply to one
 * template (e.g. `assetRetire` is carbon-credit only) skip the parameter,
 * since the method name itself already implies which template/ABI to use;
 * likewise the 4 NFT-only methods take an explicit `nftTemplate`.
 */
export interface IAdapter {
  readonly network: SupportedNetwork;

  getSignerAddress(): Promise<string>;
  getBalance(address?: string): Promise<string>;

  // ─── ERC-20 / SEP-41 fungible templates ────────────────────────────────
  deployFarmlandToken(opts: DeployFarmlandOptions): Promise<DeployResult>;
  deployCommodityReceiptToken(opts: DeployCommodityOptions): Promise<DeployResult>;
  deployRealEstateToken(opts: DeployRealEstateOptions): Promise<DeployResult>;
  deployInvoiceToken(opts: DeployInvoiceOptions): Promise<DeployResult>;
  deployCarbonCreditToken(opts: DeployCarbonCreditOptions): Promise<DeployResult>;
  deployMiningRightsToken(opts: DeployMiningRightsOptions): Promise<DeployResult>;
  getDeployerTokens(address?: string): Promise<string[]>;
  totalDeployed(): Promise<number>;

  // ─── ERC-721 / NFT deed templates ───────────────────────────────────────
  deployFarmlandNFT(opts: DeployFarmlandNFTOptions): Promise<NFTDeployResult>;
  deployRealEstateNFT(opts: DeployRealEstateNFTOptions): Promise<NFTDeployResult>;
  deployMiningRightsNFT(opts: DeployMiningRightsNFTOptions): Promise<NFTDeployResult>;
  deployCommodityVaultNFT(opts: DeployCommodityVaultNFTOptions): Promise<NFTDeployResult>;
  getDeployerNFTs(address?: string): Promise<string[]>;
  totalDeployedNFTs(): Promise<number>;

  // ─── Milestone escrow — deploy ──────────────────────────────────────────
  deployEscrow(opts: DeployEscrowOptions): Promise<EscrowDeployResult>;
  getDeployerEscrows(address?: string): Promise<string[]>;
  totalDeployedEscrows(): Promise<number>;

  // ─── Milestone escrow — lifecycle (operates on an already-deployed
  // escrow at `escrowAddress`; the caller is always the adapter's own
  // configured signer, matching whichever party — payer/payee/arbiter —
  // that signer represents for this deal) ─────────────────────────────────
  /** Funds a single milestone — milestones are funded independently, so the payer can pay in installments. */
  escrowFund(escrowAddress: string, milestoneId: number): Promise<string>;
  escrowMarkDelivered(escrowAddress: string, milestoneId: number): Promise<string>;
  escrowApproveMilestone(escrowAddress: string, milestoneId: number): Promise<string>;
  escrowRaiseDispute(escrowAddress: string, milestoneId: number): Promise<string>;
  escrowResolveDispute(escrowAddress: string, milestoneId: number, releaseToPayee: boolean): Promise<string>;
  escrowClaimTimelockRelease(escrowAddress: string, milestoneId: number): Promise<string>;
  escrowVoteCancel(escrowAddress: string): Promise<string>;
  escrowSetArbiter(escrowAddress: string, newArbiter: string): Promise<string>;
  escrowSetIdentityVerifier(escrowAddress: string, verifierAddress: string): Promise<string>;
  escrowPause(escrowAddress: string): Promise<string>;
  escrowUnpause(escrowAddress: string): Promise<string>;
  /** Full on-chain event history for a deployed escrow, oldest first. */
  escrowGetActivity(escrowAddress: string): Promise<EscrowActivityEvent[]>;
  escrowGetPayer(escrowAddress: string): Promise<string>;
  escrowGetPayee(escrowAddress: string): Promise<string>;
  escrowGetArbiter(escrowAddress: string): Promise<string>;
  escrowGetToken(escrowAddress: string): Promise<string>;
  escrowGetTotalAmount(escrowAddress: string): Promise<bigint>;
  escrowIsFunded(escrowAddress: string): Promise<boolean>;
  escrowIsCancelled(escrowAddress: string): Promise<boolean>;
  escrowMilestoneCount(escrowAddress: string): Promise<number>;
  escrowGetMilestone(escrowAddress: string, milestoneId: number): Promise<Milestone>;
  escrowRemainingBalance(escrowAddress: string): Promise<bigint>;

  // ─── Ramp settlement — deploy ────────────────────────────────────────────
  deployRampSettlement(opts: DeployRampSettlementOptions): Promise<RampSettlementDeployResult>;
  getDeployerRampSettlements(address?: string): Promise<string[]>;
  totalDeployedRampSettlements(): Promise<number>;

  // ─── Ramp settlement — lifecycle (operates on an already-deployed
  // settlement contract at `settlementAddress`; `referenceId` is a plain
  // string — each adapter hashes it into whatever on-chain key type that
  // chain's contract expects) ───────────────────────────────────────────────
  rampDepositOffRamp(settlementAddress: string, referenceId: string, tokenAddress: string, amount: bigint): Promise<string>;
  rampConfirmOffRampSettlement(settlementAddress: string, referenceId: string): Promise<string>;
  rampRefundOffRamp(settlementAddress: string, referenceId: string): Promise<string>;
  rampRecordOnRampSettlement(settlementAddress: string, referenceId: string, recipient: string, tokenAddress: string, amount: bigint): Promise<string>;
  rampGetOffRampDeposit(settlementAddress: string, referenceId: string): Promise<OffRampDeposit>;
  rampGetOnRampRecord(settlementAddress: string, referenceId: string): Promise<OnRampRecord>;

  // ─── ERC-1155 multi-token + PoolVault ────────────────────────────────────
  deployCommodityBatchToken(opts: DeployCommodityBatchOptions): Promise<MultiTokenDeployResult>;
  deployPoolVault(opts: DeployPoolVaultOptions): Promise<MultiTokenDeployResult>;
  getDeployerMultiTokens(address?: string): Promise<string[]>;
  totalDeployedMultiTokens(): Promise<number>;

  // ─── CommodityBatchToken — lifecycle (operates on an already-deployed
  // contract at `contractAddress`) ──────────────────────────────────────────
  batchRegister(contractAddress: string, batchId: bigint, metadata: BatchMetadata): Promise<string>;
  batchMint(contractAddress: string, batchId: bigint, to: string, amount: bigint): Promise<string>;

  // ─── PoolVault — lifecycle (operates on an already-deployed vault at
  // `vaultAddress`; the caller is always the adapter's own configured
  // signer, i.e. the investor) ───────────────────────────────────────────────
  poolDeposit(vaultAddress: string, tokenAddress: string, amount: bigint): Promise<string>;
  poolWithdraw(vaultAddress: string, poolTokenAmount: bigint): Promise<string>;
  poolGetStatus(vaultAddress: string): Promise<PoolVaultStatus>;

  // ─── ManualOracle — lifecycle (operates on an already-deployed oracle at
  // `oracleAddress`) ──────────────────────────────────────────────────────────
  oracleSetPrice(oracleAddress: string, tokenAddress: string, priceUSD: bigint): Promise<string>;

  // ─── Generic transfer (used by the `transfer` CLI command against any
  // deployed fungible token / NFT contract, regardless of template) ────────
  genericTransferToken(tokenAddress: string, to: string, amount: bigint): Promise<string>;
  genericTransferNFT(nftAddress: string, to: string, tokenId: bigint): Promise<string>;

  // ─── Generic token operations (used by mint/status CLI commands) ────────
  mintTokens(tokenAddress: string, to: string, amount: bigint): Promise<string>;
  getBalance2(tokenAddress: string, walletAddress: string): Promise<bigint>;
  /** Reads name/symbol/decimals off an arbitrary token contract — not necessarily an Ankara asset. Rejects if the address isn't a token contract. */
  genericGetTokenMetadata(tokenAddress: string): Promise<TokenMetadata>;

  // ─── AssetRegistry — generic reads/writes (all 6 fungible templates) ────
  assetGetName(tokenAddress: string, template: AssetTemplate): Promise<string>;
  assetGetSymbol(tokenAddress: string, template: AssetTemplate): Promise<string>;
  assetGetTotalSupply(tokenAddress: string, template: AssetTemplate): Promise<bigint>;
  assetGetBalanceOf(tokenAddress: string, template: AssetTemplate, holderAddress: string): Promise<bigint>;
  assetGetStatus(tokenAddress: string, template: AssetTemplate): Promise<AssetStatus>;
  assetGetCountryCode(tokenAddress: string, template: AssetTemplate): Promise<string>;
  assetGetIdentityVerifier(tokenAddress: string, template: AssetTemplate): Promise<string>;
  assetGetVersion(tokenAddress: string, template: AssetTemplate): Promise<number>;
  assetGetMetadata(tokenAddress: string, template: AssetTemplate): Promise<AnyAssetMetadata>;
  assetSetStatus(tokenAddress: string, template: AssetTemplate, newStatus: AssetStatus): Promise<string>;
  assetSetIdentityVerifier(tokenAddress: string, template: AssetTemplate, verifierAddress: string): Promise<string>;
  assetMint(tokenAddress: string, template: AssetTemplate, to: string, amount: bigint): Promise<string>;
  assetPause(tokenAddress: string, template: AssetTemplate): Promise<string>;
  assetUnpause(tokenAddress: string, template: AssetTemplate): Promise<string>;
  assetGetValuationUSD(tokenAddress: string, template: AssetTemplate): Promise<bigint>;

  // ─── AssetRegistry — farmland + real-estate ──────────────────────────────
  assetUpdateValuation(tokenAddress: string, template: AssetTemplate, newValuationUSD: bigint): Promise<string>;

  // ─── AssetRegistry — real-estate only ────────────────────────────────────
  assetUpdateOccupancyStatus(tokenAddress: string, newStatus: string): Promise<string>;
  assetDeclareRentalDistribution(tokenAddress: string, amountUSD: bigint): Promise<string>;

  // ─── AssetRegistry — commodity only ──────────────────────────────────────
  assetIsExpired(tokenAddress: string): Promise<boolean>;
  assetMarkExpired(tokenAddress: string): Promise<string>;

  // ─── AssetRegistry — invoice only ────────────────────────────────────────
  assetGetInvoiceStatus(tokenAddress: string): Promise<InvoiceStatus>;
  assetIsOverdue(tokenAddress: string): Promise<boolean>;
  assetMarkFunded(tokenAddress: string): Promise<string>;
  assetMarkRepaid(tokenAddress: string): Promise<string>;
  assetMarkDefaulted(tokenAddress: string, reason: string): Promise<string>;

  // ─── AssetRegistry — carbon-credit only ──────────────────────────────────
  assetRetire(tokenAddress: string, amount: bigint, beneficiary: string, note: string): Promise<string>;
  assetGetTotalRetired(tokenAddress: string): Promise<bigint>;
  assetGetTotalRetirements(tokenAddress: string): Promise<number>;
  assetGetRetirement(tokenAddress: string, index: number): Promise<RetirementRecord>;

  // ─── AssetRegistry — mining-rights only ──────────────────────────────────
  assetIsLicenseExpired(tokenAddress: string): Promise<boolean>;
  assetRenewLicense(tokenAddress: string, newExpiry: bigint): Promise<string>;
  assetMarkLicenseExpired(tokenAddress: string): Promise<string>;
  assetDeclareRoyalty(tokenAddress: string, extractionValueUSD: bigint): Promise<string>;

  // ─── AssetRegistry — NFT templates (all 4) ───────────────────────────────
  assetGetTokenMetadata(nftAddress: string, nftTemplate: NFTAssetTemplate, tokenId: number): Promise<unknown>;
  assetGetTokenVersion(nftAddress: string, nftTemplate: NFTAssetTemplate, tokenId: number): Promise<number>;
  assetOwnerOf(nftAddress: string, nftTemplate: NFTAssetTemplate, tokenId: number): Promise<string>;
  assetLinkToERC20(nftAddress: string, nftTemplate: NFTAssetTemplate, erc20Address: string): Promise<string>;
}
