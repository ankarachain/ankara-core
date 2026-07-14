import {
  ethers,
  type Signer,
  type Provider,
  type ContractTransactionReceipt,
  type ContractTransactionResponse,
} from "ethers";
import {
  TOKEN_FACTORY_ABI,
  NFT_FACTORY_ABI,
  MULTI_TOKEN_FACTORY_ABI,
  ESCROW_FACTORY_ABI,
  MILESTONE_ESCROW_ABI,
  RAMP_SETTLEMENT_FACTORY_ABI,
  RAMP_SETTLEMENT_ABI,
  FARMLAND_TOKEN_ABI,
  COMMODITY_TOKEN_ABI,
  REAL_ESTATE_TOKEN_ABI,
  INVOICE_TOKEN_ABI,
  CARBON_CREDIT_TOKEN_ABI,
  MINING_RIGHTS_TOKEN_ABI,
  FARMLAND_NFT_ABI,
  REAL_ESTATE_NFT_ABI,
  MINING_RIGHTS_NFT_ABI,
  COMMODITY_VAULT_NFT_ABI,
  COMMODITY_BATCH_TOKEN_ABI,
  POOL_VAULT_ABI,
  WHITELIST_VERIFIER_ABI,
  MANUAL_ORACLE_ABI,
  ERC20_METADATA_ABI,
} from "../utils/abis";
import { getNetwork } from "../utils/networks";
import type { IAdapter, AnyAssetMetadata } from "./IAdapter";
import type {
  EVMSupportedNetwork,
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
  MilestoneStatus,
  EscrowActivityEvent,
  EscrowActivityType,
  TokenMetadata,
  OffRampDeposit,
  OnRampRecord,
  Loan,
  AssetTemplate,
  NFTAssetTemplate,
  AssetStatus,
  InvoiceStatus,
  RetirementRecord,
  BatchMetadata,
  PoolVaultStatus,
} from "../types";
import { RampSettlementStatus } from "../types";

/**
 * EVMAdapter
 *
 * Low-level adapter for interacting with Ankara Chain contracts on EVM chains.
 * The higher-level TokenFactory and AssetRegistry classes use this internally.
 * Developers generally shouldn't need to use this directly.
 */
export class EVMAdapter implements IAdapter {
  private _signer: Signer | null = null;
  private _provider: Provider;
  private _network: EVMSupportedNetwork;
  private _factoryAddress: string | null = null;
  private _nftFactoryAddress: string | null = null;
  private _multiTokenFactoryAddress: string | null = null;
  private _escrowFactoryAddress: string | null = null;
  private _rampSettlementFactoryAddress: string | null = null;

  constructor(
    network: EVMSupportedNetwork,
    provider: Provider,
    signer?: Signer,
    factoryAddress?: string,
    nftFactoryAddress?: string,
    escrowFactoryAddress?: string,
    multiTokenFactoryAddress?: string,
    rampSettlementFactoryAddress?: string
  ) {
    this._network                       = network;
    this._provider                      = provider;
    this._signer                        = signer ?? null;
    this._factoryAddress                = factoryAddress ?? null;
    this._nftFactoryAddress             = nftFactoryAddress ?? null;
    this._escrowFactoryAddress          = escrowFactoryAddress ?? null;
    this._multiTokenFactoryAddress      = multiTokenFactoryAddress ?? null;
    this._rampSettlementFactoryAddress  = rampSettlementFactoryAddress ?? null;
  }

  // ─── Connection helpers ───────────────────────────────────────────────────

  get network(): EVMSupportedNetwork { return this._network; }
  get provider(): Provider { return this._provider; }

  get signer(): Signer {
    if (!this._signer) throw new Error("No signer configured. Pass a signer to Ankara Chain.");
    return this._signer;
  }

  /**
   * Contract "runner" for read/write calls — a configured signer when one
   * exists, falling back to the plain provider otherwise. Every contract
   * accessor (`farmlandToken()`, `milestoneEscrow()`, etc.) constructs its
   * `ethers.Contract` against this rather than the throwing `signer` getter,
   * so read-only usage (no signer configured — `status`/`useAsset`/
   * `useTokenBalance` style call sites) actually works instead of throwing
   * "No signer configured" before a single view call is even attempted.
   * Attempting a state-changing call through a providerless runner still
   * fails, just with ethers' own "does not support sending transactions"
   * error instead of this class's custom message.
   */
  private get _runner(): Signer | Provider {
    return this._signer ?? this._provider;
  }

  get factoryAddress(): string {
    if (!this._factoryAddress) throw new Error("No factory address configured.");
    return this._factoryAddress;
  }

  setFactoryAddress(address: string) {
    this._factoryAddress = address;
  }

  get nftFactoryAddress(): string {
    if (!this._nftFactoryAddress) throw new Error("No NFT factory address configured.");
    return this._nftFactoryAddress;
  }

  setNftFactoryAddress(address: string) {
    this._nftFactoryAddress = address;
  }

  get escrowFactoryAddress(): string {
    if (!this._escrowFactoryAddress) throw new Error("No escrow factory address configured.");
    return this._escrowFactoryAddress;
  }

  setEscrowFactoryAddress(address: string) {
    this._escrowFactoryAddress = address;
  }

  get multiTokenFactoryAddress(): string {
    if (!this._multiTokenFactoryAddress) throw new Error("No multi-token factory address configured.");
    return this._multiTokenFactoryAddress;
  }

  setMultiTokenFactoryAddress(address: string) {
    this._multiTokenFactoryAddress = address;
  }

  get rampSettlementFactoryAddress(): string {
    if (!this._rampSettlementFactoryAddress) throw new Error("No ramp settlement factory address configured.");
    return this._rampSettlementFactoryAddress;
  }

  setRampSettlementFactoryAddress(address: string) {
    this._rampSettlementFactoryAddress = address;
  }

  async getSignerAddress(): Promise<string> {
    return this.signer.getAddress();
  }

  async getBalance(address?: string): Promise<string> {
    const addr = address ?? await this.getSignerAddress();
    const bal  = await this._provider.getBalance(addr);
    return ethers.formatEther(bal);
  }

  private async _sendAndWait(txPromise: Promise<ContractTransactionResponse>): Promise<string> {
    const tx = await txPromise;
    const receipt = await tx.wait();
    if (!receipt) throw new Error("Transaction receipt unavailable");
    return receipt.hash;
  }

  // ─── Factory interactions ─────────────────────────────────────────────────

  private factoryContract() {
    return new ethers.Contract(
      this.factoryAddress,
      TOKEN_FACTORY_ABI,
      this._runner
    );
  }

  async deployFarmlandToken(opts: DeployFarmlandOptions): Promise<DeployResult> {
    const factory    = this.factoryContract();
    const adminAddr  = opts.admin ?? await this.getSignerAddress();
    const verifier   = opts.identityVerifier ?? ethers.ZeroAddress;
    const assetIdB32 = ethers.keccak256(ethers.toUtf8Bytes(opts.assetId));

    const meta = this._toContractFarmlandMeta(opts.metadata);

    const tx = await factory.deployFarmlandToken(
      opts.name,
      opts.symbol,
      assetIdB32,
      opts.countryCode,
      adminAddr,
      verifier,
      meta,
      { value: await factory.deploymentFee() }
    );

    const receipt: ContractTransactionReceipt = await tx.wait();
    const tokenAddress = await this._extractTokenAddress(receipt);

    return {
      tokenAddress,
      txHash:     receipt.hash,
      assetId:    opts.assetId,
      template:   "farmland",
      network:    this._network,
      deployedAt: Math.floor(Date.now() / 1000),
    };
  }

  async deployCommodityReceiptToken(
    opts: DeployCommodityOptions
  ): Promise<DeployResult> {
    const factory    = this.factoryContract();
    const adminAddr  = opts.admin ?? await this.getSignerAddress();
    const verifier   = opts.identityVerifier ?? ethers.ZeroAddress;
    const assetIdB32 = ethers.keccak256(ethers.toUtf8Bytes(opts.assetId));

    const meta = this._toContractCommodityMeta(opts.metadata);

    const tx = await factory.deployCommodityReceiptToken(
      opts.name,
      opts.symbol,
      assetIdB32,
      opts.countryCode,
      adminAddr,
      verifier,
      meta,
      { value: await factory.deploymentFee() }
    );

    const receipt: ContractTransactionReceipt = await tx.wait();
    const tokenAddress = await this._extractTokenAddress(receipt);

    return {
      tokenAddress,
      txHash:     receipt.hash,
      assetId:    opts.assetId,
      template:   "commodity",
      network:    this._network,
      deployedAt: Math.floor(Date.now() / 1000),
    };
  }

  async deployRealEstateToken(opts: DeployRealEstateOptions): Promise<DeployResult> {
    const factory    = this.factoryContract();
    const adminAddr  = opts.admin ?? await this.getSignerAddress();
    const verifier   = opts.identityVerifier ?? ethers.ZeroAddress;
    const assetIdB32 = ethers.keccak256(ethers.toUtf8Bytes(opts.assetId));
    const meta       = this._toContractRealEstateMeta(opts.metadata);

    const tx = await factory.deployRealEstateToken(
      opts.name, opts.symbol, assetIdB32, opts.countryCode,
      adminAddr, verifier, meta,
      { value: await factory.deploymentFee() }
    );
    const receipt: ContractTransactionReceipt = await tx.wait();
    const tokenAddress = await this._extractTokenAddress(receipt);
    return { tokenAddress, txHash: receipt.hash, assetId: opts.assetId, template: "real-estate", network: this._network, deployedAt: Math.floor(Date.now() / 1000) };
  }

  async deployInvoiceToken(opts: DeployInvoiceOptions): Promise<DeployResult> {
    const factory    = this.factoryContract();
    const adminAddr  = opts.admin ?? await this.getSignerAddress();
    const verifier   = opts.identityVerifier ?? ethers.ZeroAddress;
    const assetIdB32 = ethers.keccak256(ethers.toUtf8Bytes(opts.assetId));
    const meta       = this._toContractInvoiceMeta(opts.metadata);

    const tx = await factory.deployInvoiceToken(
      opts.name, opts.symbol, assetIdB32, opts.countryCode,
      adminAddr, verifier, meta,
      { value: await factory.deploymentFee() }
    );
    const receipt: ContractTransactionReceipt = await tx.wait();
    const tokenAddress = await this._extractTokenAddress(receipt);
    return { tokenAddress, txHash: receipt.hash, assetId: opts.assetId, template: "invoice", network: this._network, deployedAt: Math.floor(Date.now() / 1000) };
  }

  async deployCarbonCreditToken(opts: DeployCarbonCreditOptions): Promise<DeployResult> {
    const factory    = this.factoryContract();
    const adminAddr  = opts.admin ?? await this.getSignerAddress();
    const verifier   = opts.identityVerifier ?? ethers.ZeroAddress;
    const assetIdB32 = ethers.keccak256(ethers.toUtf8Bytes(opts.assetId));
    const meta       = this._toContractCarbonCreditMeta(opts.metadata);

    const tx = await factory.deployCarbonCreditToken(
      opts.name, opts.symbol, assetIdB32, opts.countryCode,
      adminAddr, verifier, meta,
      { value: await factory.deploymentFee() }
    );
    const receipt: ContractTransactionReceipt = await tx.wait();
    const tokenAddress = await this._extractTokenAddress(receipt);
    return { tokenAddress, txHash: receipt.hash, assetId: opts.assetId, template: "carbon-credit", network: this._network, deployedAt: Math.floor(Date.now() / 1000) };
  }

  async deployMiningRightsToken(opts: DeployMiningRightsOptions): Promise<DeployResult> {
    const factory    = this.factoryContract();
    const adminAddr  = opts.admin ?? await this.getSignerAddress();
    const verifier   = opts.identityVerifier ?? ethers.ZeroAddress;
    const assetIdB32 = ethers.keccak256(ethers.toUtf8Bytes(opts.assetId));
    const meta       = this._toContractMiningRightsMeta(opts.metadata);

    const tx = await factory.deployMiningRightsToken(
      opts.name, opts.symbol, assetIdB32, opts.countryCode,
      adminAddr, verifier, meta,
      { value: await factory.deploymentFee() }
    );
    const receipt: ContractTransactionReceipt = await tx.wait();
    const tokenAddress = await this._extractTokenAddress(receipt);
    return { tokenAddress, txHash: receipt.hash, assetId: opts.assetId, template: "mining-rights", network: this._network, deployedAt: Math.floor(Date.now() / 1000) };
  }

  async getDeployerTokens(address?: string): Promise<string[]> {
    const factory = this.factoryContract();
    const addr    = address ?? await this.getSignerAddress();
    return factory.getDeployerTokens(addr);
  }

  async totalDeployed(): Promise<number> {
    const factory = this.factoryContract();
    const n = await factory.totalDeployed();
    return Number(n);
  }

  // ─── NFT Factory interactions ─────────────────────────────────────────────

  private nftFactoryContract() {
    return new ethers.Contract(
      this.nftFactoryAddress,
      NFT_FACTORY_ABI,
      this._runner
    );
  }

  async deployFarmlandNFT(opts: DeployFarmlandNFTOptions): Promise<NFTDeployResult> {
    const factory    = this.nftFactoryContract();
    const adminAddr  = opts.admin ?? await this.getSignerAddress();
    const verifier   = opts.identityVerifier ?? ethers.ZeroAddress;
    const assetIdB32 = ethers.keccak256(ethers.toUtf8Bytes(opts.assetId));

    const tx = await factory.deployFarmlandNFT(
      opts.name, opts.symbol, assetIdB32, opts.countryCode,
      adminAddr, verifier,
      { value: await factory.deploymentFee() }
    );
    const receipt: ContractTransactionReceipt = await tx.wait();
    const nftAddress = await this._extractNFTAddress(receipt);

    return { nftAddress, txHash: receipt.hash, assetId: opts.assetId, template: "farmland-nft", network: this._network, deployedAt: Math.floor(Date.now() / 1000) };
  }

  async deployRealEstateNFT(opts: DeployRealEstateNFTOptions): Promise<NFTDeployResult> {
    const factory    = this.nftFactoryContract();
    const adminAddr  = opts.admin ?? await this.getSignerAddress();
    const verifier   = opts.identityVerifier ?? ethers.ZeroAddress;
    const assetIdB32 = ethers.keccak256(ethers.toUtf8Bytes(opts.assetId));

    const tx = await factory.deployRealEstateNFT(
      opts.name, opts.symbol, assetIdB32, opts.countryCode,
      adminAddr, verifier,
      { value: await factory.deploymentFee() }
    );
    const receipt: ContractTransactionReceipt = await tx.wait();
    const nftAddress = await this._extractNFTAddress(receipt);

    return { nftAddress, txHash: receipt.hash, assetId: opts.assetId, template: "real-estate-nft", network: this._network, deployedAt: Math.floor(Date.now() / 1000) };
  }

  async deployMiningRightsNFT(opts: DeployMiningRightsNFTOptions): Promise<NFTDeployResult> {
    const factory    = this.nftFactoryContract();
    const adminAddr  = opts.admin ?? await this.getSignerAddress();
    const verifier   = opts.identityVerifier ?? ethers.ZeroAddress;
    const assetIdB32 = ethers.keccak256(ethers.toUtf8Bytes(opts.assetId));

    const tx = await factory.deployMiningRightsNFT(
      opts.name, opts.symbol, assetIdB32, opts.countryCode,
      adminAddr, verifier,
      { value: await factory.deploymentFee() }
    );
    const receipt: ContractTransactionReceipt = await tx.wait();
    const nftAddress = await this._extractNFTAddress(receipt);

    return { nftAddress, txHash: receipt.hash, assetId: opts.assetId, template: "mining-rights-nft", network: this._network, deployedAt: Math.floor(Date.now() / 1000) };
  }

  async deployCommodityVaultNFT(opts: DeployCommodityVaultNFTOptions): Promise<NFTDeployResult> {
    const factory    = this.nftFactoryContract();
    const adminAddr  = opts.admin ?? await this.getSignerAddress();
    const verifier   = opts.identityVerifier ?? ethers.ZeroAddress;
    const assetIdB32 = ethers.keccak256(ethers.toUtf8Bytes(opts.assetId));

    const tx = await factory.deployCommodityVaultNFT(
      opts.name, opts.symbol, assetIdB32, opts.countryCode,
      adminAddr, verifier,
      { value: await factory.deploymentFee() }
    );
    const receipt: ContractTransactionReceipt = await tx.wait();
    const nftAddress = await this._extractNFTAddress(receipt);

    return { nftAddress, txHash: receipt.hash, assetId: opts.assetId, template: "commodity-vault-nft", network: this._network, deployedAt: Math.floor(Date.now() / 1000) };
  }

  async getDeployerNFTs(address?: string): Promise<string[]> {
    const factory = this.nftFactoryContract();
    const addr    = address ?? await this.getSignerAddress();
    return factory.getDeployerNFTs(addr);
  }

  async totalDeployedNFTs(): Promise<number> {
    const factory = this.nftFactoryContract();
    const n = await factory.totalDeployedNFTs();
    return Number(n);
  }

  // ─── Escrow Factory interactions ─────────────────────────────────────────

  private escrowFactoryContract() {
    return new ethers.Contract(
      this.escrowFactoryAddress,
      ESCROW_FACTORY_ABI,
      this._runner
    );
  }

  async deployEscrow(opts: DeployEscrowOptions): Promise<EscrowDeployResult> {
    const factory   = this.escrowFactoryContract();
    const adminAddr = opts.admin ?? await this.getSignerAddress();
    const arbiter   = opts.arbiter ?? ethers.ZeroAddress;
    const verifier  = opts.identityVerifier ?? ethers.ZeroAddress;

    const amounts = opts.milestones.map(m => m.amount);
    const hashes  = opts.milestones.map(m =>
      m.descriptionHash && m.descriptionHash.startsWith("0x") ? m.descriptionHash : ethers.ZeroHash
    );
    const totalAmount = amounts.reduce((sum, a) => sum + a, 0n);

    const tx = await factory.deployEscrow(
      adminAddr,
      opts.payer,
      opts.payee,
      arbiter,
      opts.token,
      verifier,
      BigInt(opts.timelockDurationSeconds ?? 0),
      amounts,
      hashes,
      { value: await factory.deploymentFee() }
    );

    const receipt: ContractTransactionReceipt = await tx.wait();
    const escrowAddress = await this._extractEscrowAddress(receipt);

    return {
      escrowAddress,
      txHash:     receipt.hash,
      payer:      opts.payer,
      payee:      opts.payee,
      token:      opts.token,
      totalAmount,
      network:    this._network,
      deployedAt: Math.floor(Date.now() / 1000),
    };
  }

  async getDeployerEscrows(address?: string): Promise<string[]> {
    const factory = this.escrowFactoryContract();
    const addr    = address ?? await this.getSignerAddress();
    return factory.getDeployerEscrows(addr);
  }

  async totalDeployedEscrows(): Promise<number> {
    const factory = this.escrowFactoryContract();
    const n = await factory.totalDeployedEscrows();
    return Number(n);
  }

  milestoneEscrow(address: string) {
    return new ethers.Contract(address, MILESTONE_ESCROW_ABI, this._runner);
  }

  // ─── Milestone escrow lifecycle (IAdapter) ─────────────────────────────────

  async escrowFund(escrowAddress: string, milestoneId: number): Promise<string> {
    return this._sendAndWait(this.milestoneEscrow(escrowAddress).fund(milestoneId));
  }

  async escrowMarkDelivered(escrowAddress: string, milestoneId: number): Promise<string> {
    return this._sendAndWait(this.milestoneEscrow(escrowAddress).markDelivered(milestoneId));
  }

  async escrowApproveMilestone(escrowAddress: string, milestoneId: number): Promise<string> {
    return this._sendAndWait(this.milestoneEscrow(escrowAddress).approveMilestone(milestoneId));
  }

  async escrowRaiseDispute(escrowAddress: string, milestoneId: number): Promise<string> {
    return this._sendAndWait(this.milestoneEscrow(escrowAddress).raiseDispute(milestoneId));
  }

  async escrowResolveDispute(escrowAddress: string, milestoneId: number, releaseToPayee: boolean): Promise<string> {
    return this._sendAndWait(this.milestoneEscrow(escrowAddress).resolveDispute(milestoneId, releaseToPayee));
  }

  async escrowClaimTimelockRelease(escrowAddress: string, milestoneId: number): Promise<string> {
    return this._sendAndWait(this.milestoneEscrow(escrowAddress).claimTimelockRelease(milestoneId));
  }

  async escrowVoteCancel(escrowAddress: string): Promise<string> {
    return this._sendAndWait(this.milestoneEscrow(escrowAddress).voteCancel());
  }

  async escrowSetArbiter(escrowAddress: string, newArbiter: string): Promise<string> {
    return this._sendAndWait(this.milestoneEscrow(escrowAddress).setArbiter(newArbiter));
  }

  async escrowSetIdentityVerifier(escrowAddress: string, verifierAddress: string): Promise<string> {
    return this._sendAndWait(this.milestoneEscrow(escrowAddress).setIdentityVerifier(verifierAddress));
  }

  async escrowPause(escrowAddress: string): Promise<string> {
    return this._sendAndWait(this.milestoneEscrow(escrowAddress).pause());
  }

  async escrowUnpause(escrowAddress: string): Promise<string> {
    return this._sendAndWait(this.milestoneEscrow(escrowAddress).unpause());
  }

  /**
   * Full on-chain event history for a deployed escrow, oldest first. Scans
   * from block 0 — fine for the localhost/testnet use this dashboard targets,
   * but would need pagination/an indexer on a long-lived mainnet deployment.
   */
  async escrowGetActivity(escrowAddress: string): Promise<EscrowActivityEvent[]> {
    const contract = this.milestoneEscrow(escrowAddress);
    const eventNames = [
      "MilestoneFunded",
      "MilestoneDelivered",
      "MilestoneReleased",
      "MilestoneDisputed",
      "DisputeResolved",
      "MilestoneRefunded",
      "EscrowCancelled",
    ] as const;

    const logsByName = await Promise.all(eventNames.map(name => contract.queryFilter(name, 0, "latest")));
    const allLogs = logsByName.flat() as ethers.EventLog[];

    const events = await Promise.all(allLogs.map(async (log): Promise<EscrowActivityEvent> => {
      const block = await log.getBlock();
      const base = { txHash: log.transactionHash, timestamp: block.timestamp };
      const args = log.args;
      switch (log.fragment.name) {
        case "MilestoneFunded":
          return { ...base, type: "funded", milestoneId: Number(args.id), data: { amount: args.amount } };
        case "MilestoneDelivered":
          return { ...base, type: "delivered", milestoneId: Number(args.id) };
        case "MilestoneReleased":
          return { ...base, type: "released", milestoneId: Number(args.id), data: { amount: args.amount, viaTimelock: args.viaTimelock } };
        case "MilestoneDisputed":
          return { ...base, type: "disputed", milestoneId: Number(args.id), data: { raisedBy: args.raisedBy } };
        case "DisputeResolved":
          return { ...base, type: "resolved", milestoneId: Number(args.id), data: { releasedToPayee: args.releasedToPayee } };
        case "MilestoneRefunded":
          return { ...base, type: "refunded", milestoneId: Number(args.id), data: { amount: args.amount } };
        case "EscrowCancelled":
          return { ...base, type: "cancelled", data: { refundedAmount: args.refundedAmount } };
        default:
          throw new Error(`Unhandled escrow event: ${log.fragment.name}`);
      }
    }));

    events.sort((a, b) => a.timestamp - b.timestamp);
    return events;
  }

  async escrowGetPayer(escrowAddress: string): Promise<string> {
    return this.milestoneEscrow(escrowAddress).payer();
  }

  async escrowGetPayee(escrowAddress: string): Promise<string> {
    return this.milestoneEscrow(escrowAddress).payee();
  }

  async escrowGetArbiter(escrowAddress: string): Promise<string> {
    return this.milestoneEscrow(escrowAddress).arbiter();
  }

  async escrowGetToken(escrowAddress: string): Promise<string> {
    return this.milestoneEscrow(escrowAddress).token();
  }

  async escrowGetTotalAmount(escrowAddress: string): Promise<bigint> {
    return this.milestoneEscrow(escrowAddress).totalAmount();
  }

  async escrowIsFunded(escrowAddress: string): Promise<boolean> {
    return this.milestoneEscrow(escrowAddress).funded();
  }

  async escrowIsCancelled(escrowAddress: string): Promise<boolean> {
    return this.milestoneEscrow(escrowAddress).cancelled();
  }

  async escrowMilestoneCount(escrowAddress: string): Promise<number> {
    const n = await this.milestoneEscrow(escrowAddress).milestoneCount();
    return Number(n);
  }

  async escrowGetMilestone(escrowAddress: string, milestoneId: number): Promise<Milestone> {
    const m = await this.milestoneEscrow(escrowAddress).getMilestone(milestoneId);
    return {
      amount:          m.amount,
      descriptionHash: m.descriptionHash,
      status:          Number(m.status) as MilestoneStatus,
      deliveredAt:     m.deliveredAt,
      funded:          m.funded,
    };
  }

  async escrowRemainingBalance(escrowAddress: string): Promise<bigint> {
    return this.milestoneEscrow(escrowAddress).remainingBalance();
  }

  // ─── Ramp Settlement Factory interactions ─────────────────────────────────

  private rampSettlementFactoryContract() {
    return new ethers.Contract(
      this.rampSettlementFactoryAddress,
      RAMP_SETTLEMENT_FACTORY_ABI,
      this._runner
    );
  }

  async deployRampSettlement(opts: DeployRampSettlementOptions): Promise<RampSettlementDeployResult> {
    const factory   = this.rampSettlementFactoryContract();
    const adminAddr = opts.admin ?? await this.getSignerAddress();

    const tx = await factory.deployRampSettlement(
      adminAddr,
      opts.treasury,
      { value: await factory.deploymentFee() }
    );

    const receipt: ContractTransactionReceipt = await tx.wait();
    const settlementAddress = await this._extractRampSettlementAddress(receipt);

    return {
      settlementAddress,
      txHash:     receipt.hash,
      treasury:   opts.treasury,
      network:    this._network,
      deployedAt: Math.floor(Date.now() / 1000),
    };
  }

  async getDeployerRampSettlements(address?: string): Promise<string[]> {
    const factory = this.rampSettlementFactoryContract();
    const addr    = address ?? await this.getSignerAddress();
    return factory.getDeployerRampSettlements(addr);
  }

  async totalDeployedRampSettlements(): Promise<number> {
    const factory = this.rampSettlementFactoryContract();
    const n = await factory.totalDeployedRampSettlements();
    return Number(n);
  }

  rampSettlement(address: string) {
    return new ethers.Contract(address, RAMP_SETTLEMENT_ABI, this._runner);
  }

  // ─── Ramp settlement lifecycle (IAdapter) ──────────────────────────────────

  private _refId(referenceId: string): string {
    return ethers.keccak256(ethers.toUtf8Bytes(referenceId));
  }

  async rampDepositOffRamp(
    settlementAddress: string,
    referenceId: string,
    tokenAddress: string,
    amount: bigint
  ): Promise<string> {
    return this._sendAndWait(
      this.rampSettlement(settlementAddress).initiateOffRamp(
        this._refId(referenceId), tokenAddress, amount, referenceId
      )
    );
  }

  async rampConfirmOffRampSettlement(settlementAddress: string, referenceId: string): Promise<string> {
    return this._sendAndWait(
      this.rampSettlement(settlementAddress).confirmOffRampSettlement(this._refId(referenceId))
    );
  }

  async rampRefundOffRamp(settlementAddress: string, referenceId: string): Promise<string> {
    return this._sendAndWait(
      this.rampSettlement(settlementAddress).refundOffRamp(this._refId(referenceId))
    );
  }

  async rampRecordOnRampSettlement(
    settlementAddress: string,
    referenceId: string,
    recipient: string,
    tokenAddress: string,
    amount: bigint
  ): Promise<string> {
    return this._sendAndWait(
      this.rampSettlement(settlementAddress).recordOnRampSettlement(
        this._refId(referenceId), recipient, tokenAddress, amount, referenceId
      )
    );
  }

  async rampGetOffRampDeposit(settlementAddress: string, referenceId: string): Promise<OffRampDeposit> {
    const d = await this.rampSettlement(settlementAddress).getOffRamp(this._refId(referenceId));
    return {
      depositor:   d.depositor,
      token:       d.token,
      amount:      d.amount,
      status:      Number(d.status) as RampSettlementStatus,
      initiatedAt: d.initiatedAt,
    };
  }

  async rampGetOnRampRecord(settlementAddress: string, referenceId: string): Promise<OnRampRecord> {
    const r = await this.rampSettlement(settlementAddress).getOnRamp(this._refId(referenceId));
    return {
      recipient:  r.recipient,
      token:      r.token,
      amount:     r.amount,
      status:     Number(r.status) as RampSettlementStatus,
      recordedAt: r.recordedAt,
    };
  }

  // ─── Multi-Token Factory interactions ─────────────────────────────────────

  private multiTokenFactoryContract() {
    return new ethers.Contract(
      this.multiTokenFactoryAddress,
      MULTI_TOKEN_FACTORY_ABI,
      this._runner
    );
  }

  async deployCommodityBatchToken(
    opts: DeployCommodityBatchOptions
  ): Promise<MultiTokenDeployResult> {
    const factory   = this.multiTokenFactoryContract();
    const adminAddr = opts.admin ?? await this.getSignerAddress();

    const warehouseMeta = {
      warehouseId:          opts.warehouse.warehouseId,
      warehouseLocation:    opts.warehouse.warehouseLocation,
      operatorAddress:      opts.warehouse.operatorAddress ?? adminAddr,
      warehouseLicenseHash: opts.warehouse.warehouseLicenseHash?.startsWith("0x")
        ? opts.warehouse.warehouseLicenseHash
        : ethers.ZeroHash,
      certificationExpiry:  opts.warehouse.certificationExpiry ?? BigInt(9_999_999_999),
    };

    const tx = await factory.deployCommodityBatchToken(
      opts.name,
      opts.countryCode,
      opts.baseURI,
      adminAddr,
      warehouseMeta,
      { value: await factory.deploymentFee() }
    );

    const receipt: ContractTransactionReceipt = await tx.wait();
    const contractAddress = await this._extractMultiTokenAddress(receipt);

    return {
      contractAddress,
      txHash:     receipt.hash,
      template:   "commodity-batch",
      network:    this._network,
      deployedAt: Math.floor(Date.now() / 1000),
    };
  }

  async deployPoolVault(opts: DeployPoolVaultOptions): Promise<MultiTokenDeployResult> {
    const factory    = this.multiTokenFactoryContract();
    const adminAddr  = opts.admin ?? await this.getSignerAddress();
    const verifier   = opts.identityVerifier ?? ethers.ZeroAddress;
    const oracle     = opts.oracle ?? ethers.ZeroAddress;
    const assetIdB32 = ethers.keccak256(ethers.toUtf8Bytes(opts.assetId));

    const tx = await factory.deployPoolVault(
      opts.name,
      opts.symbol,
      assetIdB32,
      opts.countryCode,
      adminAddr,
      verifier,
      oracle,
      BigInt(opts.managementFeeBps ?? 0),
      { value: await factory.deploymentFee() }
    );

    const receipt: ContractTransactionReceipt = await tx.wait();
    const contractAddress = await this._extractMultiTokenAddress(receipt);

    return {
      contractAddress,
      txHash:     receipt.hash,
      template:   "pool-vault",
      network:    this._network,
      deployedAt: Math.floor(Date.now() / 1000),
    };
  }

  async getDeployerMultiTokens(address?: string): Promise<string[]> {
    const factory = this.multiTokenFactoryContract();
    const addr    = address ?? await this.getSignerAddress();
    return factory.getDeployerMultiTokens(addr);
  }

  async totalDeployedMultiTokens(): Promise<number> {
    const factory = this.multiTokenFactoryContract();
    const n = await factory.totalDeployedMultiTokens();
    return Number(n);
  }

  commodityBatchToken(address: string) {
    return new ethers.Contract(address, COMMODITY_BATCH_TOKEN_ABI, this._runner);
  }

  poolVault(address: string) {
    return new ethers.Contract(address, POOL_VAULT_ABI, this._runner);
  }

  // ─── NFT Token accessors ─────────────────────────────────────────────────

  farmlandNFT(address: string) {
    return new ethers.Contract(address, FARMLAND_NFT_ABI, this._runner);
  }

  realEstateNFT(address: string) {
    return new ethers.Contract(address, REAL_ESTATE_NFT_ABI, this._runner);
  }

  miningRightsNFT(address: string) {
    return new ethers.Contract(address, MINING_RIGHTS_NFT_ABI, this._runner);
  }

  commodityVaultNFT(address: string) {
    return new ethers.Contract(address, COMMODITY_VAULT_NFT_ABI, this._runner);
  }

  // ─── Token interactions ───────────────────────────────────────────────────

  farmlandToken(address: string) {
    return new ethers.Contract(address, FARMLAND_TOKEN_ABI, this._runner);
  }

  commodityToken(address: string) {
    return new ethers.Contract(address, COMMODITY_TOKEN_ABI, this._runner);
  }

  realEstateToken(address: string) {
    return new ethers.Contract(address, REAL_ESTATE_TOKEN_ABI, this._runner);
  }

  invoiceToken(address: string) {
    return new ethers.Contract(address, INVOICE_TOKEN_ABI, this._runner);
  }

  carbonCreditToken(address: string) {
    return new ethers.Contract(address, CARBON_CREDIT_TOKEN_ABI, this._runner);
  }

  miningRightsToken(address: string) {
    return new ethers.Contract(address, MINING_RIGHTS_TOKEN_ABI, this._runner);
  }

  whitelistVerifier(address: string) {
    return new ethers.Contract(address, WHITELIST_VERIFIER_ABI, this._runner);
  }

  manualOracle(address: string) {
    return new ethers.Contract(address, MANUAL_ORACLE_ABI, this._runner);
  }

  async mintTokens(
    tokenAddress: string,
    to: string,
    amount: bigint
  ): Promise<string> {
    const token  = this.farmlandToken(tokenAddress);
    const tx     = await token.mint(to, amount);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async getBalance2(tokenAddress: string, walletAddress: string): Promise<bigint> {
    const token = this.farmlandToken(tokenAddress);
    return token.balanceOf(walletAddress);
  }

  async genericGetTokenMetadata(tokenAddress: string): Promise<TokenMetadata> {
    const token = new ethers.Contract(tokenAddress, ERC20_METADATA_ABI, this._runner);
    const [name, symbol, decimals] = await Promise.all([token.name(), token.symbol(), token.decimals()]);
    return { name, symbol, decimals: Number(decimals) };
  }

  // ─── AssetRegistry (IAdapter) ──────────────────────────────────────────────

  private assetToken(address: string, template: AssetTemplate) {
    switch (template) {
      case "farmland": return this.farmlandToken(address);
      case "commodity": return this.commodityToken(address);
      case "real-estate": return this.realEstateToken(address);
      case "invoice": return this.invoiceToken(address);
      case "carbon-credit": return this.carbonCreditToken(address);
      case "mining-rights": return this.miningRightsToken(address);
    }
  }

  private assetNFT(address: string, template: NFTAssetTemplate) {
    switch (template) {
      case "farmland-nft": return this.farmlandNFT(address);
      case "real-estate-nft": return this.realEstateNFT(address);
      case "mining-rights-nft": return this.miningRightsNFT(address);
      case "commodity-vault-nft": return this.commodityVaultNFT(address);
    }
  }

  async assetGetName(tokenAddress: string, template: AssetTemplate): Promise<string> {
    return this.assetToken(tokenAddress, template).name();
  }

  async assetGetSymbol(tokenAddress: string, template: AssetTemplate): Promise<string> {
    return this.assetToken(tokenAddress, template).symbol();
  }

  async assetGetTotalSupply(tokenAddress: string, template: AssetTemplate): Promise<bigint> {
    return this.assetToken(tokenAddress, template).totalSupply();
  }

  async assetGetBalanceOf(tokenAddress: string, template: AssetTemplate, holderAddress: string): Promise<bigint> {
    return this.assetToken(tokenAddress, template).balanceOf(holderAddress);
  }

  async assetGetStatus(tokenAddress: string, template: AssetTemplate): Promise<AssetStatus> {
    const s = await this.assetToken(tokenAddress, template).status();
    return Number(s) as AssetStatus;
  }

  async assetGetCountryCode(tokenAddress: string, template: AssetTemplate): Promise<string> {
    return this.assetToken(tokenAddress, template).countryCode();
  }

  async assetGetIdentityVerifier(tokenAddress: string, template: AssetTemplate): Promise<string> {
    return this.assetToken(tokenAddress, template).identityVerifier();
  }

  async assetGetVersion(tokenAddress: string, template: AssetTemplate): Promise<number> {
    const v = await this.assetToken(tokenAddress, template).metadataVersion();
    return Number(v);
  }

  async assetGetMetadata(tokenAddress: string, template: AssetTemplate): Promise<AnyAssetMetadata> {
    return this.assetToken(tokenAddress, template).getMetadata();
  }

  async assetSetStatus(tokenAddress: string, template: AssetTemplate, newStatus: AssetStatus): Promise<string> {
    return this._sendAndWait(this.assetToken(tokenAddress, template).setStatus(newStatus));
  }

  async assetSetIdentityVerifier(tokenAddress: string, template: AssetTemplate, verifierAddress: string): Promise<string> {
    return this._sendAndWait(this.assetToken(tokenAddress, template).setIdentityVerifier(verifierAddress));
  }

  async assetMint(tokenAddress: string, template: AssetTemplate, to: string, amount: bigint): Promise<string> {
    return this._sendAndWait(this.assetToken(tokenAddress, template).mint(to, amount));
  }

  async assetPause(tokenAddress: string, template: AssetTemplate): Promise<string> {
    return this._sendAndWait(this.assetToken(tokenAddress, template).pause());
  }

  async assetUnpause(tokenAddress: string, template: AssetTemplate): Promise<string> {
    return this._sendAndWait(this.assetToken(tokenAddress, template).unpause());
  }

  async assetGetValuationUSD(tokenAddress: string, template: AssetTemplate): Promise<bigint> {
    return this.assetToken(tokenAddress, template).valuationUSD();
  }

  async assetUpdateValuation(tokenAddress: string, template: AssetTemplate, newValuationUSD: bigint): Promise<string> {
    return this._sendAndWait(this.assetToken(tokenAddress, template).updateValuation(newValuationUSD));
  }

  async assetUpdateOccupancyStatus(tokenAddress: string, newStatus: string): Promise<string> {
    return this._sendAndWait(this.realEstateToken(tokenAddress).updateOccupancyStatus(newStatus));
  }

  async assetDeclareRentalDistribution(tokenAddress: string, amountUSD: bigint): Promise<string> {
    return this._sendAndWait(this.realEstateToken(tokenAddress).declareRentalDistribution(amountUSD));
  }

  async assetIsExpired(tokenAddress: string): Promise<boolean> {
    return this.commodityToken(tokenAddress).isExpired();
  }

  async assetMarkExpired(tokenAddress: string): Promise<string> {
    return this._sendAndWait(this.commodityToken(tokenAddress).markExpired());
  }

  async assetGetInvoiceStatus(tokenAddress: string): Promise<InvoiceStatus> {
    const s = await this.invoiceToken(tokenAddress).invoiceStatus();
    return Number(s) as InvoiceStatus;
  }

  async assetIsOverdue(tokenAddress: string): Promise<boolean> {
    return this.invoiceToken(tokenAddress).isOverdue();
  }

  async assetMarkFunded(tokenAddress: string): Promise<string> {
    return this._sendAndWait(this.invoiceToken(tokenAddress).markFunded());
  }

  async assetMarkRepaid(tokenAddress: string): Promise<string> {
    return this._sendAndWait(this.invoiceToken(tokenAddress).markRepaid());
  }

  async assetMarkDefaulted(tokenAddress: string, reason: string): Promise<string> {
    return this._sendAndWait(this.invoiceToken(tokenAddress).markDefaulted(reason));
  }

  async assetRetire(tokenAddress: string, amount: bigint, beneficiary: string, note: string): Promise<string> {
    return this._sendAndWait(this.carbonCreditToken(tokenAddress).retire(amount, beneficiary, note));
  }

  async assetGetTotalRetired(tokenAddress: string): Promise<bigint> {
    return this.carbonCreditToken(tokenAddress).totalRetired();
  }

  async assetGetTotalRetirements(tokenAddress: string): Promise<number> {
    const n = await this.carbonCreditToken(tokenAddress).totalRetirements();
    return Number(n);
  }

  async assetGetRetirement(tokenAddress: string, index: number): Promise<RetirementRecord> {
    const r = await this.carbonCreditToken(tokenAddress).getRetirement(index);
    return {
      retiredBy: r[0],
      amount: r[1],
      timestamp: r[2],
      beneficiary: r[3],
      retirementNote: r[4],
    };
  }

  async assetIsLicenseExpired(tokenAddress: string): Promise<boolean> {
    return this.miningRightsToken(tokenAddress).isLicenseExpired();
  }

  async assetRenewLicense(tokenAddress: string, newExpiry: bigint): Promise<string> {
    return this._sendAndWait(this.miningRightsToken(tokenAddress).renewLicense(newExpiry));
  }

  async assetMarkLicenseExpired(tokenAddress: string): Promise<string> {
    return this._sendAndWait(this.miningRightsToken(tokenAddress).markLicenseExpired());
  }

  async assetDeclareRoyalty(tokenAddress: string, extractionValueUSD: bigint): Promise<string> {
    return this._sendAndWait(this.miningRightsToken(tokenAddress).declareRoyalty(extractionValueUSD));
  }

  async assetGetTokenMetadata(nftAddress: string, nftTemplate: NFTAssetTemplate, tokenId: number): Promise<unknown> {
    return this.assetNFT(nftAddress, nftTemplate).getMetadata(tokenId);
  }

  async assetGetTokenVersion(nftAddress: string, nftTemplate: NFTAssetTemplate, tokenId: number): Promise<number> {
    const v = await this.assetNFT(nftAddress, nftTemplate).metadataVersion(tokenId);
    return Number(v);
  }

  async assetOwnerOf(nftAddress: string, nftTemplate: NFTAssetTemplate, tokenId: number): Promise<string> {
    return this.assetNFT(nftAddress, nftTemplate).ownerOf(tokenId);
  }

  async assetLinkToERC20(nftAddress: string, nftTemplate: NFTAssetTemplate, erc20Address: string): Promise<string> {
    return this._sendAndWait(this.assetNFT(nftAddress, nftTemplate).linkToERC20(erc20Address));
  }

  // ─── CommodityBatchToken (IAdapter) ────────────────────────────────────────

  async batchRegister(contractAddress: string, batchId: bigint, metadata: BatchMetadata): Promise<string> {
    const meta = {
      commodityType: metadata.commodityType,
      quantityKg: metadata.quantityKg,
      gradeClassification: metadata.gradeClassification,
      depositDate: metadata.depositDate,
      expiryDate: metadata.expiryDate,
      inspectionReportHash: metadata.inspectionReportHash.startsWith("0x")
        ? metadata.inspectionReportHash
        : ethers.ZeroHash,
      valuationUSD: metadata.valuationUSD,
      harvestSeason: metadata.harvestSeason,
      originCountry: metadata.originCountry,
    };
    return this._sendAndWait(this.commodityBatchToken(contractAddress).registerBatch(batchId, meta));
  }

  async batchMint(contractAddress: string, batchId: bigint, to: string, amount: bigint): Promise<string> {
    return this._sendAndWait(this.commodityBatchToken(contractAddress).mint(to, batchId, amount, "0x"));
  }

  // ─── PoolVault (IAdapter) ───────────────────────────────────────────────────

  async poolDeposit(vaultAddress: string, tokenAddress: string, amount: bigint): Promise<string> {
    return this._sendAndWait(this.poolVault(vaultAddress).deposit(tokenAddress, amount));
  }

  async poolWithdraw(vaultAddress: string, poolTokenAmount: bigint): Promise<string> {
    return this._sendAndWait(this.poolVault(vaultAddress).withdraw(poolTokenAmount));
  }

  async poolGetStatus(vaultAddress: string): Promise<PoolVaultStatus> {
    const vault = this.poolVault(vaultAddress);
    const [name, symbol, totalSupply, navPerToken, totalAUM, managementFeeBps, acceptedTokens, lastFeeAccrual, oracle] =
      await Promise.all([
        vault.name(),
        vault.symbol(),
        vault.totalSupply(),
        vault.NAVPerToken(),
        vault.totalAUM(),
        vault.managementFeeBps(),
        vault.acceptedTokens(),
        vault.lastFeeAccrual(),
        vault.oracle(),
      ]);
    return {
      name, symbol, totalSupply, navPerToken, totalAUM,
      managementFeeBps: Number(managementFeeBps),
      acceptedTokens,
      lastFeeAccrual,
      oracle: oracle === ethers.ZeroAddress ? "" : oracle,
    };
  }

  // ─── ManualOracle (IAdapter) ────────────────────────────────────────────────

  async oracleSetPrice(oracleAddress: string, tokenAddress: string, priceUSD: bigint): Promise<string> {
    return this._sendAndWait(this.manualOracle(oracleAddress).setPrice(tokenAddress, priceUSD));
  }

  // ─── CollateralVault (IAdapter) — Stellar-only in v1: no CollateralVault.sol
  // exists yet, so every method here throws rather than silently no-op'ing.
  // Interface methods are still declared on EVMAdapter (not omitted) to keep
  // IAdapter's cross-chain contract unified — see IAdapter.ts's doc comment
  // on why every adapter implements the full interface. ──────────────────────

  private _vaultNotAvailable(): never {
    throw new Error("CollateralVault is not yet available on EVM — it's a Stellar-only feature in v1.");
  }

  async vaultOpenLoan(): Promise<{ loanId: number; txHash: string }> {
    this._vaultNotAvailable();
  }

  async vaultRepayLoan(): Promise<string> {
    this._vaultNotAvailable();
  }

  async vaultLiquidate(): Promise<string> {
    this._vaultNotAvailable();
  }

  async vaultSetLtvBps(): Promise<string> {
    this._vaultNotAvailable();
  }

  async vaultSetLiquidationThresholdBps(): Promise<string> {
    this._vaultNotAvailable();
  }

  async vaultSetOracle(): Promise<string> {
    this._vaultNotAvailable();
  }

  async vaultPause(): Promise<string> {
    this._vaultNotAvailable();
  }

  async vaultUnpause(): Promise<string> {
    this._vaultNotAvailable();
  }

  async vaultGetLoan(): Promise<Loan> {
    this._vaultNotAvailable();
  }

  async vaultGetBorrowerLoans(): Promise<number[]> {
    this._vaultNotAvailable();
  }

  async vaultCurrentLtvBps(): Promise<number> {
    this._vaultNotAvailable();
  }

  async vaultIsLiquidatable(): Promise<boolean> {
    this._vaultNotAvailable();
  }

  async vaultGetBorrowedToken(): Promise<string> {
    this._vaultNotAvailable();
  }

  async vaultGetOracle(): Promise<string> {
    this._vaultNotAvailable();
  }

  async vaultGetLtvBps(): Promise<number> {
    this._vaultNotAvailable();
  }

  async vaultGetLiquidationThresholdBps(): Promise<number> {
    this._vaultNotAvailable();
  }

  async vaultIsPaused(): Promise<boolean> {
    this._vaultNotAvailable();
  }

  // ─── Generic transfer (IAdapter) ────────────────────────────────────────────

  async genericTransferToken(tokenAddress: string, to: string, amount: bigint): Promise<string> {
    const contract = new ethers.Contract(
      tokenAddress,
      ["function transfer(address to, uint256 amount) returns (bool)"],
      this._runner
    );
    return this._sendAndWait(contract.transfer(to, amount));
  }

  async genericTransferNFT(nftAddress: string, to: string, tokenId: bigint): Promise<string> {
    const from = await this.getSignerAddress();
    const contract = new ethers.Contract(
      nftAddress,
      ["function transferFrom(address from, address to, uint256 tokenId)"],
      this._runner
    );
    return this._sendAndWait(contract.transferFrom(from, to, tokenId));
  }

  // ─── Metadata helpers ─────────────────────────────────────────────────────

  private _toContractFarmlandMeta(meta: FarmlandMetadata) {
    return {
      location:          meta.location,
      areaSqMeters:      meta.areaSqMeters,
      soilType:          meta.soilType,
      irrigationType:    meta.irrigationType,
      cropHistory:       meta.cropHistory,
      titleDocumentHash: meta.titleDocumentHash.startsWith("0x")
        ? meta.titleDocumentHash
        : ethers.ZeroHash,
      valuationUSD:      meta.valuationUSD,
      stateRegion:       meta.stateRegion,
      lastUpdated:       meta.lastUpdated,
    };
  }

  private _toContractCommodityMeta(meta: CommodityMetadata) {
    return {
      commodityType:       meta.commodityType,
      quantityKg:          meta.quantityKg,
      gradeClassification: meta.gradeClassification,
      warehouseId:         meta.warehouseId,
      warehouseLocation:   meta.warehouseLocation,
      depositDate:         meta.depositDate,
      expiryDate:          meta.expiryDate,
      inspectionReportHash: meta.inspectionReportHash.startsWith("0x")
        ? meta.inspectionReportHash
        : ethers.ZeroHash,
      valuationUSD:        meta.valuationUSD,
      harvestSeason:       meta.harvestSeason,
      lastUpdated:         meta.lastUpdated,
    };
  }

  private _toContractRealEstateMeta(meta: RealEstateMetadata) {
    return {
      propertyId:         meta.propertyId,
      propertyType:       meta.propertyType,
      locationAddress:    meta.locationAddress,
      totalAreaSqMeters:  meta.totalAreaSqMeters,
      titleDocumentHash:  meta.titleDocumentHash.startsWith("0x") ? meta.titleDocumentHash : ethers.ZeroHash,
      valuationUSD:       meta.valuationUSD,
      rentalYieldBps:     meta.rentalYieldBps,
      occupancyStatus:    meta.occupancyStatus,
      developerAddress:   meta.developerAddress,
      lastUpdated:        meta.lastUpdated,
    };
  }

  private _toContractInvoiceMeta(meta: InvoiceMetadata) {
    return {
      invoiceNumber:       meta.invoiceNumber,
      debtorReference:     meta.debtorReference,
      faceValueUSD:        meta.faceValueUSD,
      discountRateBps:     meta.discountRateBps,
      issuanceDate:        meta.issuanceDate,
      dueDate:             meta.dueDate,
      invoiceDocumentHash: meta.invoiceDocumentHash.startsWith("0x") ? meta.invoiceDocumentHash : ethers.ZeroHash,
      currency:            meta.currency,
      lastUpdated:         meta.lastUpdated,
    };
  }

  private _toContractCarbonCreditMeta(meta: CarbonCreditMetadata) {
    return {
      creditType:           meta.creditType,
      verificationBodyRef:  meta.verificationBodyRef,
      vintageYear:          meta.vintageYear,
      quantityCO2e:         meta.quantityCO2e,
      projectLocation:      meta.projectLocation,
      projectType:          meta.projectType,
      verificationDocHash:  meta.verificationDocHash.startsWith("0x") ? meta.verificationDocHash : ethers.ZeroHash,
      lastUpdated:          meta.lastUpdated,
    };
  }

  private _toContractMiningRightsMeta(meta: MiningRightsMetadata) {
    return {
      licenseNumber:       meta.licenseNumber,
      mineralType:         meta.mineralType,
      concessionArea:      meta.concessionArea,
      areaHectares:        meta.areaHectares,
      licenseExpiry:       meta.licenseExpiry,
      issuingAuthority:    meta.issuingAuthority,
      licenseDocumentHash: meta.licenseDocumentHash.startsWith("0x") ? meta.licenseDocumentHash : ethers.ZeroHash,
      royaltyRateBps:      meta.royaltyRateBps,
      lastUpdated:         meta.lastUpdated,
    };
  }

  private async _extractTokenAddress(
    receipt: ContractTransactionReceipt
  ): Promise<string> {
    const iface  = new ethers.Interface(TOKEN_FACTORY_ABI);
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === "TokenDeployed") {
          return parsed.args.tokenAddress;
        }
      } catch { /* skip non-matching logs */ }
    }
    throw new Error("TokenDeployed event not found in transaction receipt");
  }

  private async _extractNFTAddress(
    receipt: ContractTransactionReceipt
  ): Promise<string> {
    const iface  = new ethers.Interface(NFT_FACTORY_ABI);
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === "NFTDeployed") {
          return parsed.args.nftAddress;
        }
      } catch { /* skip non-matching logs */ }
    }
    throw new Error("NFTDeployed event not found in transaction receipt");
  }

  private async _extractEscrowAddress(
    receipt: ContractTransactionReceipt
  ): Promise<string> {
    const iface  = new ethers.Interface(ESCROW_FACTORY_ABI);
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === "EscrowDeployed") {
          return parsed.args.escrowAddress;
        }
      } catch { /* skip non-matching logs */ }
    }
    throw new Error("EscrowDeployed event not found in transaction receipt");
  }

  private async _extractMultiTokenAddress(
    receipt: ContractTransactionReceipt
  ): Promise<string> {
    const iface  = new ethers.Interface(MULTI_TOKEN_FACTORY_ABI);
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === "MultiTokenDeployed") {
          return parsed.args.contractAddress;
        }
      } catch { /* skip non-matching logs */ }
    }
    throw new Error("MultiTokenDeployed event not found in transaction receipt");
  }

  private async _extractRampSettlementAddress(
    receipt: ContractTransactionReceipt
  ): Promise<string> {
    const iface  = new ethers.Interface(RAMP_SETTLEMENT_FACTORY_ABI);
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === "RampSettlementDeployed") {
          return parsed.args.settlementAddress;
        }
      } catch { /* skip non-matching logs */ }
    }
    throw new Error("RampSettlementDeployed event not found in transaction receipt");
  }
}
