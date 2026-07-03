import { ethers } from "ethers";
import { EVMAdapter } from "../adapters/evm";
import {
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
} from "../utils/abis";
import type {
  AssetTemplate,
  NFTAssetTemplate,
  AssetStatus,
  FarmlandMetadata,
  CommodityMetadata,
  RealEstateMetadata,
  InvoiceMetadata,
  CarbonCreditMetadata,
  MiningRightsMetadata,
  RetirementRecord,
} from "../types";
import { InvoiceStatus } from "../types";

type AnyMetadata =
  | FarmlandMetadata
  | CommodityMetadata
  | RealEstateMetadata
  | InvoiceMetadata
  | CarbonCreditMetadata
  | MiningRightsMetadata;

type AnyTemplate = AssetTemplate | NFTAssetTemplate;

const TEMPLATE_ABIS: Record<AnyTemplate, readonly string[]> = {
  "farmland":            FARMLAND_TOKEN_ABI,
  "commodity":           COMMODITY_TOKEN_ABI,
  "real-estate":         REAL_ESTATE_TOKEN_ABI,
  "invoice":             INVOICE_TOKEN_ABI,
  "carbon-credit":       CARBON_CREDIT_TOKEN_ABI,
  "mining-rights":       MINING_RIGHTS_TOKEN_ABI,
  // NFT templates
  "farmland-nft":        FARMLAND_NFT_ABI,
  "real-estate-nft":     REAL_ESTATE_NFT_ABI,
  "mining-rights-nft":   MINING_RIGHTS_NFT_ABI,
  "commodity-vault-nft": COMMODITY_VAULT_NFT_ABI,
};

/**
 * AssetRegistry
 *
 * Read and write asset metadata on deployed Ankara Chain tokens.
 * Supports all 6 African asset class templates.
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
  private _adapter: EVMAdapter;
  private _address: string;
  private _template: AnyTemplate;

  constructor(
    adapter: EVMAdapter,
    tokenAddress: string,
    template: AnyTemplate
  ) {
    this._adapter  = adapter;
    this._address  = tokenAddress;
    this._template = template;
  }

  // ─── Generic reads (all templates) ───────────────────────────────────────

  async getName(): Promise<string> {
    return this._token().name();
  }

  async getSymbol(): Promise<string> {
    return this._token().symbol();
  }

  async getTotalSupply(): Promise<bigint> {
    return this._token().totalSupply();
  }

  async getBalanceOf(address: string): Promise<bigint> {
    return this._token().balanceOf(address);
  }

  async getStatus(): Promise<AssetStatus> {
    const s = await this._token().status();
    return Number(s) as AssetStatus;
  }

  async getCountryCode(): Promise<string> {
    return this._token().countryCode();
  }

  async getIdentityVerifier(): Promise<string> {
    return this._token().identityVerifier();
  }

  async getVersion(): Promise<number> {
    const v = await this._token().metadataVersion();
    return Number(v);
  }

  async getMetadata(): Promise<AnyMetadata> {
    return this._token().getMetadata();
  }

  // ─── Generic writes (all templates) ──────────────────────────────────────

  async setStatus(newStatus: AssetStatus): Promise<string> {
    const tx      = await this._token().setStatus(newStatus);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async setIdentityVerifier(verifierAddress: string): Promise<string> {
    const tx      = await this._token().setIdentityVerifier(verifierAddress);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async mint(to: string, amount: bigint): Promise<string> {
    const tx      = await this._token().mint(to, amount);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async pause(): Promise<string> {
    const tx      = await this._token().pause();
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async unpause(): Promise<string> {
    const tx      = await this._token().unpause();
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async getValuationUSD(): Promise<bigint> {
    return this._token().valuationUSD();
  }

  // ─── Farmland + Real Estate: valuation ───────────────────────────────────

  /**
   * Update the USD valuation on-chain.
   * Available on: farmland, real-estate
   */
  async updateValuation(newValuationUSD: bigint): Promise<string> {
    this._requireOneOf(["farmland", "real-estate"], "updateValuation");
    const tx      = await this._token().updateValuation(newValuationUSD);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  // ─── Real Estate ─────────────────────────────────────────────────────────

  async updateOccupancyStatus(newStatus: string): Promise<string> {
    this._requireTemplate("real-estate", "updateOccupancyStatus");
    const tx      = await this._token().updateOccupancyStatus(newStatus);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async declareRentalDistribution(amountUSD: bigint): Promise<string> {
    this._requireTemplate("real-estate", "declareRentalDistribution");
    const tx      = await this._token().declareRentalDistribution(amountUSD);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  // ─── Commodity ────────────────────────────────────────────────────────────

  async isExpired(): Promise<boolean> {
    this._requireTemplate("commodity", "isExpired");
    return this._token().isExpired();
  }

  async markExpired(): Promise<string> {
    this._requireTemplate("commodity", "markExpired");
    const tx      = await this._token().markExpired();
    const receipt = await tx.wait();
    return receipt.hash;
  }

  // ─── Invoice ─────────────────────────────────────────────────────────────

  async getInvoiceStatus(): Promise<InvoiceStatus> {
    this._requireTemplate("invoice", "getInvoiceStatus");
    const s = await this._token().invoiceStatus();
    return Number(s) as InvoiceStatus;
  }

  async isOverdue(): Promise<boolean> {
    this._requireTemplate("invoice", "isOverdue");
    return this._token().isOverdue();
  }

  async markFunded(): Promise<string> {
    this._requireTemplate("invoice", "markFunded");
    const tx      = await this._token().markFunded();
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async markRepaid(): Promise<string> {
    this._requireTemplate("invoice", "markRepaid");
    const tx      = await this._token().markRepaid();
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async markDefaulted(reason: string): Promise<string> {
    this._requireTemplate("invoice", "markDefaulted");
    const tx      = await this._token().markDefaulted(reason);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  // ─── Carbon Credit ────────────────────────────────────────────────────────

  async retire(amount: bigint, beneficiary: string, note: string): Promise<string> {
    this._requireTemplate("carbon-credit", "retire");
    const tx      = await this._token().retire(amount, beneficiary, note);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async getTotalRetired(): Promise<bigint> {
    this._requireTemplate("carbon-credit", "getTotalRetired");
    return this._token().totalRetired();
  }

  async getTotalRetirements(): Promise<number> {
    this._requireTemplate("carbon-credit", "getTotalRetirements");
    const n = await this._token().totalRetirements();
    return Number(n);
  }

  async getRetirement(index: number): Promise<RetirementRecord> {
    this._requireTemplate("carbon-credit", "getRetirement");
    const r = await this._token().getRetirement(index);
    return {
      retiredBy:      r[0],
      amount:         r[1],
      timestamp:      r[2],
      beneficiary:    r[3],
      retirementNote: r[4],
    };
  }

  // ─── Mining Rights ────────────────────────────────────────────────────────

  async isLicenseExpired(): Promise<boolean> {
    this._requireTemplate("mining-rights", "isLicenseExpired");
    return this._token().isLicenseExpired();
  }

  async renewLicense(newExpiry: bigint): Promise<string> {
    this._requireTemplate("mining-rights", "renewLicense");
    const tx      = await this._token().renewLicense(newExpiry);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async markLicenseExpired(): Promise<string> {
    this._requireTemplate("mining-rights", "markLicenseExpired");
    const tx      = await this._token().markLicenseExpired();
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async declareRoyalty(extractionValueUSD: bigint): Promise<string> {
    this._requireTemplate("mining-rights", "declareRoyalty");
    const tx      = await this._token().declareRoyalty(extractionValueUSD);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _token(): any {
    return new ethers.Contract(
      this._address,
      TEMPLATE_ABIS[this._template],
      this._adapter.signer
    );
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
    const nftTemplates: AnyTemplate[] = ["farmland-nft", "real-estate-nft", "mining-rights-nft", "commodity-vault-nft"];
    if (!nftTemplates.includes(this._template)) {
      throw new Error(`${method} is only available on NFT templates`);
    }
  }

  // ─── NFT-specific methods ─────────────────────────────────────────────────

  async getTokenMetadata(tokenId: number): Promise<unknown> {
    this._requireNFT("getTokenMetadata");
    return this._token().getMetadata(tokenId);
  }

  async getTokenVersion(tokenId: number): Promise<number> {
    this._requireNFT("getTokenVersion");
    const v = await this._token().metadataVersion(tokenId);
    return Number(v);
  }

  async ownerOf(tokenId: number): Promise<string> {
    this._requireNFT("ownerOf");
    return this._token().ownerOf(tokenId);
  }

  async linkToERC20(erc20Address: string): Promise<string> {
    this._requireNFT("linkToERC20");
    const tx      = await this._token().linkToERC20(erc20Address);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  get address(): string      { return this._address; }
  get template(): AnyTemplate { return this._template; }
}
