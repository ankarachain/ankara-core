import type { IAdapter, AnyAssetMetadata } from "../adapters/IAdapter";
import type {
  AssetTemplate,
  NFTAssetTemplate,
  AssetStatus,
  RetirementRecord,
} from "../types";
import type { TitleFlags, CustodyEntry } from "../types/rwa";
import { InvoiceStatus } from "../types";

type AnyTemplate = AssetTemplate | NFTAssetTemplate;

/** The generic-invocation surface of `StellarAdapter`, duck-typed so this file doesn't import the Stellar SDK. */
interface StellarInvoker {
  invokeContract<T = unknown>(contractId: string, method: string, args?: Record<string, unknown>): Promise<{ result: T; txHash: string }>;
  readContract<T = unknown>(contractId: string, method: string, args?: Record<string, unknown>): Promise<T>;
}

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

  // ─── Compliance policy (Stellar only, all 6 fungible templates) ──────────

  /**
   * Attaches a `compliance-policy` contract (freeze / clawback / transfer
   * rules) to this token, or detaches it with `null`. Opt-in: tokens without
   * a policy behave as before. Requires the token's Manager role.
   * Stellar only — manage the policy itself with the `CompliancePolicy` class.
   */
  async setCompliancePolicy(policyAddress: string | null): Promise<string> {
    this._requireFungible("setCompliancePolicy");
    const { txHash } = await this._stellarCompliance("setCompliancePolicy").invokeContract(
      this._address, "set_compliance_policy", { new_policy: policyAddress ?? undefined }
    );
    return txHash;
  }

  /** The attached compliance policy's address, or `null` if none. Stellar only. */
  async getCompliancePolicy(): Promise<string | null> {
    this._requireFungible("getCompliancePolicy");
    const raw = await this._stellarCompliance("getCompliancePolicy").readContract<string | null | undefined>(
      this._address, "compliance_policy", {}
    );
    return raw ?? null;
  }

  private _requireFungible(method: string): void {
    if (NFT_TEMPLATES.includes(this._template)) {
      throw new Error(`${method}() is only available on fungible templates, not "${this._template}"`);
    }
  }

  private _stellarCompliance(method: string): StellarInvoker {
    const adapter = this._adapter as Partial<StellarInvoker>;
    if (typeof adapter.invokeContract !== "function" || typeof adapter.readContract !== "function") {
      throw new Error(`${method}() is only available on Stellar — compliance policies have no EVM implementation yet`);
    }
    return adapter as StellarInvoker;
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

  /** Retire credits and record the independent registry's reference (e.g. a Verra serial). Stellar only. */
  async retireWithRegistryRef(amount: bigint, beneficiary: string, note: string, externalRegistryId: string): Promise<string> {
    this._requireTemplate("carbon-credit", "retireWithRegistryRef");
    const stellar = this._stellarRwa("retireWithRegistryRef");
    const retiredBy = await (this._adapter as { getSignerAddress(): Promise<string> }).getSignerAddress();
    return (await stellar.invokeContract(this._address, "retire_with_registry_ref", {
      retired_by: retiredBy, amount, beneficiary, note, external_registry_id: externalRegistryId,
    })).txHash;
  }

  /** Attach a registry reference to a past retirement (Manager, write-once). Stellar only. */
  async setRetirementRegistryRef(index: number, externalRegistryId: string): Promise<string> {
    this._requireTemplate("carbon-credit", "setRetirementRegistryRef");
    return (await this._stellarRwa("setRetirementRegistryRef").invokeContract(this._address, "set_retirement_registry_ref", {
      index, external_registry_id: externalRegistryId,
    })).txHash;
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

  // ─── Balance snapshots (Stellar, fungible templates) ─────────────────────

  /** Takes a balance snapshot (Manager) and returns its id. `RevenueDistributor` does this for you. */
  async snapshot(): Promise<{ snapshotId: number; txHash: string }> {
    this._requireFungibleRwa("snapshot");
    const { result, txHash } = await this._stellarRwa("snapshot").invokeContract<number>(this._address, "snapshot", {});
    return { snapshotId: Number(result), txHash };
  }

  async getCurrentSnapshotId(): Promise<number> {
    this._requireFungibleRwa("getCurrentSnapshotId");
    return Number(await this._stellarRwa("getCurrentSnapshotId").readContract(this._address, "current_snapshot_id", {}));
  }

  async getBalanceOfAt(holder: string, snapshotId: number): Promise<bigint> {
    this._requireFungibleRwa("getBalanceOfAt");
    return BigInt(await this._stellarRwa("getBalanceOfAt").readContract<bigint>(this._address, "balance_of_at", { id: holder, snapshot_id: snapshotId }));
  }

  async getTotalSupplyAt(snapshotId: number): Promise<bigint> {
    this._requireFungibleRwa("getTotalSupplyAt");
    return BigInt(await this._stellarRwa("getTotalSupplyAt").readContract<bigint>(this._address, "total_supply_at", { snapshot_id: snapshotId }));
  }

  // ─── Title encumbrances & chain of custody (Stellar, farmland-nft / real-estate-nft)

  /** Flag (`reference`) or clear (`null`) a dispute on a title NFT. Manager only. */
  async setDispute(tokenId: number, reference: string | null): Promise<string> {
    this._requireOneOf(["farmland-nft", "real-estate-nft"], "setDispute");
    return (await this._stellarRwa("setDispute").invokeContract(this._address, "set_dispute", {
      token_id: BigInt(tokenId), reference: reference ?? undefined,
    })).txHash;
  }

  /** Flag (`reference`) or clear (`null`) a lien on a title NFT. Manager only. */
  async setLien(tokenId: number, reference: string | null): Promise<string> {
    this._requireOneOf(["farmland-nft", "real-estate-nft"], "setLien");
    return (await this._stellarRwa("setLien").invokeContract(this._address, "set_lien", {
      token_id: BigInt(tokenId), reference: reference ?? undefined,
    })).txHash;
  }

  async getTitleFlags(tokenId: number): Promise<TitleFlags> {
    this._requireOneOf(["farmland-nft", "real-estate-nft"], "getTitleFlags");
    const r = await this._stellarRwa("getTitleFlags").readContract<{
      disputed: boolean; dispute_ref: string; liened: boolean; lien_ref: string; updated_at: bigint;
    }>(this._address, "title_flags", { token_id: BigInt(tokenId) });
    return { disputed: r.disputed, disputeRef: r.dispute_ref, liened: r.liened, lienRef: r.lien_ref, updatedAt: BigInt(r.updated_at) };
  }

  /** Append a chain-of-custody entry (append-only). Manager only. Returns the entry index. */
  async appendCustody(tokenId: number, owner: string, reference: string, effectiveAt: bigint): Promise<{ index: number; txHash: string }> {
    this._requireOneOf(["farmland-nft", "real-estate-nft"], "appendCustody");
    const { result, txHash } = await this._stellarRwa("appendCustody").invokeContract<number>(this._address, "append_custody", {
      token_id: BigInt(tokenId), owner, reference, effective_at: effectiveAt,
    });
    return { index: Number(result), txHash };
  }

  async getCustodyCount(tokenId: number): Promise<number> {
    this._requireOneOf(["farmland-nft", "real-estate-nft"], "getCustodyCount");
    return Number(await this._stellarRwa("getCustodyCount").readContract(this._address, "custody_count", { token_id: BigInt(tokenId) }));
  }

  /** Oldest-first page of the custody log (max 50 per page). */
  async getCustodyLog(tokenId: number, start = 0, limit = 50): Promise<CustodyEntry[]> {
    this._requireOneOf(["farmland-nft", "real-estate-nft"], "getCustodyLog");
    const rows = await this._stellarRwa("getCustodyLog").readContract<Array<{
      owner: string; reference: string; effective_at: bigint; recorded_at: bigint; recorded_by: string;
    }>>(this._address, "custody_log", { token_id: BigInt(tokenId), start, limit: Math.min(limit, 50) });
    return rows.map((r) => ({
      owner: r.owner, reference: r.reference, effectiveAt: BigInt(r.effective_at), recordedAt: BigInt(r.recorded_at), recordedBy: r.recorded_by,
    }));
  }

  private _requireFungibleRwa(method: string): void {
    if (NFT_TEMPLATES.includes(this._template)) {
      throw new Error(`${method} is only available on fungible templates, not "${this._template}"`);
    }
  }

  private _stellarRwa(method: string): StellarInvoker {
    const adapter = this._adapter as Partial<StellarInvoker>;
    if (typeof adapter.invokeContract !== "function" || typeof adapter.readContract !== "function") {
      throw new Error(`${method}() is only available on Stellar — there is no EVM implementation yet`);
    }
    return adapter as StellarInvoker;
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
