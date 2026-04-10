import { ethers } from "ethers";
import { EVMAdapter } from "../adapters/evm";
import { FARMLAND_TOKEN_ABI, COMMODITY_TOKEN_ABI } from "../utils/abis";
import type { AssetStatus, FarmlandMetadata, CommodityMetadata } from "../types";

/**
 * AssetRegistry
 *
 * Read and write asset metadata on deployed Ankara Chain tokens.
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
  private _template: "farmland" | "commodity";

  constructor(
    adapter: EVMAdapter,
    tokenAddress: string,
    template: "farmland" | "commodity"
  ) {
    this._adapter  = adapter;
    this._address  = tokenAddress;
    this._template = template;
  }

  // ─── Reads ───────────────────────────────────────────────────────────────

  async getName(): Promise<string> {
    const token = this._token();
    return token.name();
  }

  async getSymbol(): Promise<string> {
    const token = this._token();
    return token.symbol();
  }

  async getTotalSupply(): Promise<bigint> {
    const token = this._token();
    return token.totalSupply();
  }

  async getBalanceOf(address: string): Promise<bigint> {
    const token = this._token();
    return token.balanceOf(address);
  }

  async getStatus(): Promise<AssetStatus> {
    const token = this._token();
    const s = await token.status();
    return Number(s) as AssetStatus;
  }

  async getCountryCode(): Promise<string> {
    const token = this._token();
    return token.countryCode();
  }

  async getIdentityVerifier(): Promise<string> {
    const token = this._token();
    return token.identityVerifier();
  }

  async getVersion(): Promise<number> {
    const token = this._token();
    const v = await token.metadataVersion();
    return Number(v);
  }

  async getMetadata(): Promise<FarmlandMetadata | CommodityMetadata> {
    const token = this._token();
    return token.getMetadata();
  }

  async getValuationUSD(): Promise<bigint> {
    const token = this._token();
    return token.valuationUSD();
  }

  // ─── Writes ──────────────────────────────────────────────────────────────

  async setStatus(newStatus: AssetStatus): Promise<string> {
    const token   = this._token();
    const tx      = await token.setStatus(newStatus);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async setIdentityVerifier(verifierAddress: string): Promise<string> {
    const token   = this._token();
    const tx      = await token.setIdentityVerifier(verifierAddress);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async mint(to: string, amount: bigint): Promise<string> {
    const token   = this._token();
    const tx      = await token.mint(to, amount);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async updateValuation(newValuationUSD: bigint): Promise<string> {
    if (this._template !== "farmland") {
      throw new Error("updateValuation is only available on farmland tokens");
    }
    const token   = this._token();
    const tx      = await token.updateValuation(newValuationUSD);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async pause(): Promise<string> {
    const token   = this._token();
    const tx      = await token.pause();
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async unpause(): Promise<string> {
    const token   = this._token();
    const tx      = await token.unpause();
    const receipt = await tx.wait();
    return receipt.hash;
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private _token() {
    const abi = this._template === "farmland"
      ? FARMLAND_TOKEN_ABI
      : COMMODITY_TOKEN_ABI;
    return new ethers.Contract(this._address, abi, this._adapter.signer);
  }

  get address(): string { return this._address; }
  get template(): string { return this._template; }
}
