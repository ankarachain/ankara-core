import {
  ethers,
  type Signer,
  type Provider,
  type ContractTransactionReceipt,
} from "ethers";
import {
  TOKEN_FACTORY_ABI,
  NFT_FACTORY_ABI,
  ESCROW_FACTORY_ABI,
  MILESTONE_ESCROW_ABI,
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
  WHITELIST_VERIFIER_ABI,
} from "../utils/abis";
import { getNetwork } from "../utils/networks";
import type {
  SupportedNetwork,
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
} from "../types";

/**
 * EVMAdapter
 *
 * Low-level adapter for interacting with Ankara Chain contracts on EVM chains.
 * The higher-level TokenFactory and AssetRegistry classes use this internally.
 * Developers generally shouldn't need to use this directly.
 */
export class EVMAdapter {
  private _signer: Signer | null = null;
  private _provider: Provider;
  private _network: SupportedNetwork;
  private _factoryAddress: string | null = null;
  private _nftFactoryAddress: string | null = null;
  private _escrowFactoryAddress: string | null = null;

  constructor(
    network: SupportedNetwork,
    provider: Provider,
    signer?: Signer,
    factoryAddress?: string,
    nftFactoryAddress?: string,
    escrowFactoryAddress?: string
  ) {
    this._network              = network;
    this._provider             = provider;
    this._signer               = signer ?? null;
    this._factoryAddress       = factoryAddress ?? null;
    this._nftFactoryAddress    = nftFactoryAddress ?? null;
    this._escrowFactoryAddress = escrowFactoryAddress ?? null;
  }

  // ─── Connection helpers ───────────────────────────────────────────────────

  get network(): SupportedNetwork { return this._network; }
  get provider(): Provider { return this._provider; }

  get signer(): Signer {
    if (!this._signer) throw new Error("No signer configured. Pass a signer to Ankara Chain.");
    return this._signer;
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

  async getSignerAddress(): Promise<string> {
    return this.signer.getAddress();
  }

  async getBalance(address?: string): Promise<string> {
    const addr = address ?? await this.getSignerAddress();
    const bal  = await this._provider.getBalance(addr);
    return ethers.formatEther(bal);
  }

  // ─── Factory interactions ─────────────────────────────────────────────────

  private factoryContract() {
    return new ethers.Contract(
      this.factoryAddress,
      TOKEN_FACTORY_ABI,
      this.signer
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
      this.signer
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
      this.signer
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
    return new ethers.Contract(address, MILESTONE_ESCROW_ABI, this.signer);
  }

  // ─── NFT Token accessors ─────────────────────────────────────────────────

  farmlandNFT(address: string) {
    return new ethers.Contract(address, FARMLAND_NFT_ABI, this.signer);
  }

  realEstateNFT(address: string) {
    return new ethers.Contract(address, REAL_ESTATE_NFT_ABI, this.signer);
  }

  miningRightsNFT(address: string) {
    return new ethers.Contract(address, MINING_RIGHTS_NFT_ABI, this.signer);
  }

  commodityVaultNFT(address: string) {
    return new ethers.Contract(address, COMMODITY_VAULT_NFT_ABI, this.signer);
  }

  // ─── Token interactions ───────────────────────────────────────────────────

  farmlandToken(address: string) {
    return new ethers.Contract(address, FARMLAND_TOKEN_ABI, this.signer);
  }

  commodityToken(address: string) {
    return new ethers.Contract(address, COMMODITY_TOKEN_ABI, this.signer);
  }

  realEstateToken(address: string) {
    return new ethers.Contract(address, REAL_ESTATE_TOKEN_ABI, this.signer);
  }

  invoiceToken(address: string) {
    return new ethers.Contract(address, INVOICE_TOKEN_ABI, this.signer);
  }

  carbonCreditToken(address: string) {
    return new ethers.Contract(address, CARBON_CREDIT_TOKEN_ABI, this.signer);
  }

  miningRightsToken(address: string) {
    return new ethers.Contract(address, MINING_RIGHTS_TOKEN_ABI, this.signer);
  }

  whitelistVerifier(address: string) {
    return new ethers.Contract(address, WHITELIST_VERIFIER_ABI, this.signer);
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
}
