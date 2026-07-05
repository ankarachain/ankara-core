import type { IAdapter, AnyAssetMetadata } from "../adapters/IAdapter";
import type {
  AssetTemplate,
  NFTAssetTemplate,
  AssetStatus,
  RetirementRecord,
} from "../types";
import { InvoiceStatus } from "../types";

type AnyTemplate = AssetTemplate | NFTAssetTemplate;

const NFT_TEMPLATES: AnyTemplate[] = ["farmland-nft", "real-estate-nft", "mining-rights-nft", "commodity-vault-nft"];

/**
 * AssetRegistry
 *
 * Read and write asset metadata on deployed Ankara Chain tokens.
 * Supports all 6 African asset class templates. Works against a deployed
 * token/NFT on either chain: pass an `EVMAdapter` or a `StellarAdapter`,
 * both implement `IAdapter`.
 *
 * @example
 * ```typescript
 * const registry = new AssetRegistry(adapter, "0xTokenAddress", "farmland");
 *
 * const meta    = await registry.getMetadata();
 * const version = await registry.getVersion();
 *
 * await registry.updateValuation(ethers.parseEther("150000"));
 * ```
 */
export class AssetRegistry {
  private _adapter: IAdapter;
  private _address: string;
  private _template: AnyTemplate;

  constructor(
    adapter: IAdapter,
    tokenAddress: string,
    template: AnyTemplate
  ) {
    this._adapter  = adapter;
    this._address  = tokenAddress;
    this._template = template;
  }

  // ─── Generic reads (all templates) ───────────────────────────────────────

  async getName(): Promise<string> {
    return this._adapter.assetGetName(this._address, this._fungibleTemplate());
  }

  async getSymbol(): Promise<string> {
    return this._adapter.assetGetSymbol(this._address, this._fungibleTemplate());
  }

  async getTotalSupply(): Promise<bigint> {
    return this._adapter.assetGetTotalSupply(this._address, this._fungibleTemplate());
  }

  async getBalanceOf(address: string): Promise<bigint> {
    return this._adapter.assetGetBalanceOf(this._address, this._fungibleTemplate(), address);
  }

  async getStatus(): Promise<AssetStatus> {
    return this._adapter.assetGetStatus(this._address, this._fungibleTemplate());
  }

  async getCountryCode(): Promise<string> {
    return this._adapter.assetGetCountryCode(this._address, this._fungibleTemplate());
  }

  async getIdentityVerifier(): Promise<string> {
    return this._adapter.assetGetIdentityVerifier(this._address, this._fungibleTemplate());
  }

  async getVersion(): Promise<number> {
    return this._adapter.assetGetVersion(this._address, this._fungibleTemplate());
  }

  async getMetadata(): Promise<AnyAssetMetadata> {
    return this._adapter.assetGetMetadata(this._address, this._fungibleTemplate());
  }

  // ─── Generic writes (all templates) ──────────────────────────────────────

  async setStatus(newStatus: AssetStatus): Promise<string> {
    return this._adapter.assetSetStatus(this._address, this._fungibleTemplate(), newStatus);
  }

  async setIdentityVerifier(verifierAddress: string): Promise<string> {
    return this._adapter.assetSetIdentityVerifier(this._address, this._fungibleTemplate(), verifierAddress);
  }

  async mint(to: string, amount: bigint): Promise<string> {
    return this._adapter.assetMint(this._address, this._fungibleTemplate(), to, amount);
  }

  async pause(): Promise<string> {
    return this._adapter.assetPause(this._address, this._fungibleTemplate());
  }

  async unpause(): Promise<string> {
    return this._adapter.assetUnpause(this._address, this._fungibleTemplate());
  }

  async getValuationUSD(): Promise<bigint> {
    return this._adapter.assetGetValuationUSD(this._address, this._fungibleTemplate());
  }

  // ─── Farmland + Real Estate: valuation ───────────────────────────────────

  /**
   * Update the USD valuation on-chain.
   * Available on: farmland, real-estate
   */
  async updateValuation(newValuationUSD: bigint): Promise<string> {
    this._requireOneOf(["farmland", "real-estate"], "updateValuation");
    return this._adapter.assetUpdateValuation(this._address, this._fungibleTemplate(), newValuationUSD);
  }

  // ─── Real Estate ─────────────────────────────────────────────────────────

  async updateOccupancyStatus(newStatus: string): Promise<string> {
    this._requireTemplate("real-estate", "updateOccupancyStatus");
    return this._adapter.assetUpdateOccupancyStatus(this._address, newStatus);
  }

  async declareRentalDistribution(amountUSD: bigint): Promise<string> {
    this._requireTemplate("real-estate", "declareRentalDistribution");
    return this._adapter.assetDeclareRentalDistribution(this._address, amountUSD);
  }

  // ─── Commodity ────────────────────────────────────────────────────────────

  async isExpired(): Promise<boolean> {
    this._requireTemplate("commodity", "isExpired");
    return this._adapter.assetIsExpired(this._address);
  }

  async markExpired(): Promise<string> {
    this._requireTemplate("commodity", "markExpired");
    return this._adapter.assetMarkExpired(this._address);
  }

  // ─── Invoice ─────────────────────────────────────────────────────────────

  async getInvoiceStatus(): Promise<InvoiceStatus> {
    this._requireTemplate("invoice", "getInvoiceStatus");
    return this._adapter.assetGetInvoiceStatus(this._address);
  }

  async isOverdue(): Promise<boolean> {
    this._requireTemplate("invoice", "isOverdue");
    return this._adapter.assetIsOverdue(this._address);
  }

  async markFunded(): Promise<string> {
    this._requireTemplate("invoice", "markFunded");
    return this._adapter.assetMarkFunded(this._address);
  }

  async markRepaid(): Promise<string> {
    this._requireTemplate("invoice", "markRepaid");
    return this._adapter.assetMarkRepaid(this._address);
  }

  async markDefaulted(reason: string): Promise<string> {
    this._requireTemplate("invoice", "markDefaulted");
    return this._adapter.assetMarkDefaulted(this._address, reason);
  }

  // ─── Carbon Credit ────────────────────────────────────────────────────────

  async retire(amount: bigint, beneficiary: string, note: string): Promise<string> {
    this._requireTemplate("carbon-credit", "retire");
    return this._adapter.assetRetire(this._address, amount, beneficiary, note);
  }

  async getTotalRetired(): Promise<bigint> {
    this._requireTemplate("carbon-credit", "getTotalRetired");
    return this._adapter.assetGetTotalRetired(this._address);
  }

  async getTotalRetirements(): Promise<number> {
    this._requireTemplate("carbon-credit", "getTotalRetirements");
    return this._adapter.assetGetTotalRetirements(this._address);
  }

  async getRetirement(index: number): Promise<RetirementRecord> {
    this._requireTemplate("carbon-credit", "getRetirement");
    return this._adapter.assetGetRetirement(this._address, index);
  }

  // ─── Mining Rights ────────────────────────────────────────────────────────

  async isLicenseExpired(): Promise<boolean> {
    this._requireTemplate("mining-rights", "isLicenseExpired");
    return this._adapter.assetIsLicenseExpired(this._address);
  }

  async renewLicense(newExpiry: bigint): Promise<string> {
    this._requireTemplate("mining-rights", "renewLicense");
    return this._adapter.assetRenewLicense(this._address, newExpiry);
  }

  async markLicenseExpired(): Promise<string> {
    this._requireTemplate("mining-rights", "markLicenseExpired");
    return this._adapter.assetMarkLicenseExpired(this._address);
  }

  async declareRoyalty(extractionValueUSD: bigint): Promise<string> {
    this._requireTemplate("mining-rights", "declareRoyalty");
    return this._adapter.assetDeclareRoyalty(this._address, extractionValueUSD);
  }

  // ─── NFT-specific methods ─────────────────────────────────────────────────

  async getTokenMetadata(tokenId: number): Promise<unknown> {
    this._requireNFT("getTokenMetadata");
    return this._adapter.assetGetTokenMetadata(this._address, this._nftTemplate(), tokenId);
  }

  async getTokenVersion(tokenId: number): Promise<number> {
    this._requireNFT("getTokenVersion");
    return this._adapter.assetGetTokenVersion(this._address, this._nftTemplate(), tokenId);
  }

  async ownerOf(tokenId: number): Promise<string> {
    this._requireNFT("ownerOf");
    return this._adapter.assetOwnerOf(this._address, this._nftTemplate(), tokenId);
  }

  async linkToERC20(erc20Address: string): Promise<string> {
    this._requireNFT("linkToERC20");
    return this._adapter.assetLinkToERC20(this._address, this._nftTemplate(), erc20Address);
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private _fungibleTemplate(): AssetTemplate {
    return this._template as AssetTemplate;
  }

  private _nftTemplate(): NFTAssetTemplate {
    return this._template as NFTAssetTemplate;
  }

  private _requireTemplate(template: AnyTemplate, method: string): void {
    if (this._template !== template) {
      throw new Error(`${method} is only available on ${template} tokens`);
    }
  }

  private _requireOneOf(templates: AnyTemplate[], method: string): void {
    if (!templates.includes(this._template)) {
      throw new Error(`${method} is only available on ${templates.join(" / ")} tokens`);
    }
  }

  private _requireNFT(method: string): void {
    if (!NFT_TEMPLATES.includes(this._template)) {
      throw new Error(`${method} is only available on NFT templates`);
    }
  }

  get address(): string      { return this._address; }
  get template(): AnyTemplate { return this._template; }
}
