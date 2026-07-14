import { randomBytes } from "node:crypto";
import { Asset, Keypair, hash, rpc, scValToNative, Contract, TransactionBuilder, Account } from "@stellar/stellar-sdk";
import {
  Client as StellarContractClient,
  basicNodeSigner,
  type ClientOptions,
} from "@stellar/stellar-sdk/contract";
import { getNetwork } from "../utils/networks";
import type { IAdapter, AnyAssetMetadata } from "./IAdapter";
import type {
  StellarSupportedNetwork,
  StellarExternalSigner,
  StellarAnkaraChainConfig,
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
  EscrowActivityType,
  TokenMetadata,
  OffRampDeposit,
  OnRampRecord,
  AssetTemplate,
  NFTAssetTemplate,
  RetirementRecord,
  BatchMetadata,
  PoolVaultStatus,
  Loan,
} from "../types";
// Value (not type-only) imports — `decodeStatusEnum` below needs the actual
// enum objects at runtime to map a Soroban tag string back to its number.
import { RampSettlementStatus, MilestoneStatus, AssetStatus, InvoiceStatus, LoanStatus } from "../types";

/**
 * A Soroban contract's generated client has one method per contract
 * function, added dynamically from the on-chain spec — there's no static
 * type for this the way there is for a hand-written class. `EVMAdapter`
 * has the exact same situation with `ethers.Contract` (also a dynamically
 * shaped proxy) and takes the same approach: call through a loosely typed
 * handle rather than fabricating per-contract TypeScript bindings.
 */
type DynamicClient = Record<
  string,
  (args?: Record<string, unknown>) => Promise<{
    signAndSend: () => Promise<{
      result: unknown;
      getTransactionResponse?: { txHash?: string };
    }>;
    result: unknown;
  }>
>;

const STROOP = 10_000_000; // 1 XLM = 10^7 stroops

function hexToBytes32(hex: string): Buffer {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const buf = Buffer.from(clean.padStart(64, "0"), "hex");
  if (buf.length !== 32) {
    throw new Error(`Expected a 32-byte hex value, got ${buf.length} bytes: ${hex}`);
  }
  return buf;
}

/**
 * Soroban has no keccak256 builtin the way the EVM does — `hash()` (SHA-256,
 * re-exported from `@stellar/stellar-sdk`) is the natural analogue for
 * deriving a stable 32-byte identifier from a human-readable asset ID
 * string, mirroring `EVMAdapter`'s `ethers.keccak256(ethers.toUtf8Bytes(...))`.
 */
function assetIdToBytes32(assetId: string): Buffer {
  return hash(Buffer.from(assetId, "utf-8"));
}

/**
 * A Soroban unit-variant `#[contracttype] enum` (`MilestoneStatus`,
 * `AssetStatus`, `InvoiceStatus`, `RampSettlementStatus` — all fieldless,
 * single-PascalCase-word variants) decodes via `scValToNative` to
 * `{ tag: "VariantName" }`, not the plain number the SDK's TS enums use —
 * confirmed live against a real deployed escrow (`get_milestone` returned
 * `{"tag":"Released"}`). The corresponding TS enum member names are the same
 * word upper-cased (`Released` -> `RELEASED`), so that's used to map back to
 * the numeric value the rest of the SDK (and the dashboard) actually expects.
 */
function decodeStatusEnum<T extends Record<string, number | string>>(enumObj: T, raw: unknown): Extract<T[keyof T], number> {
  const tag = typeof raw === "object" && raw !== null && "tag" in raw ? (raw as { tag: string }).tag : String(raw);
  const key = tag.toUpperCase();
  const value = enumObj[key];
  if (typeof value !== "number") {
    throw new Error(`Unrecognized enum tag "${tag}" — no matching member on the given TS enum`);
  }
  return value as Extract<T[keyof T], number>;
}

/**
 * Inverse of `decodeStatusEnum`, for the write direction. The dynamic
 * client's arg encoder expects `{ tag: "VariantName" }` for these same
 * enums, not the raw TS number — confirmed live (`assetSetStatus(..., 1)`
 * failed with `TypeError: no such enum entry: undefined in [object Object]`,
 * since it tried to read `.tag` off a plain number). Uses the TS numeric
 * enum's auto-generated reverse mapping (`AssetStatus[1] === "ACTIVE"`) and
 * re-cases it to match Rust's PascalCase variant name.
 */
function encodeStatusEnum<T extends Record<string, number | string>>(enumObj: T, value: number): { tag: string } {
  const name = enumObj[value];
  if (typeof name !== "string") {
    throw new Error(`Unrecognized enum value ${value} — no matching member on the given TS enum`);
  }
  return { tag: name.charAt(0) + name.slice(1).toLowerCase() };
}

/**
 * StellarAdapter
 *
 * Low-level adapter for interacting with Ankara Chain contracts deployed to
 * Stellar via Soroban. Implements the same `IAdapter` surface as
 * `EVMAdapter` so `TokenFactory` can route to either transparently.
 * Developers generally shouldn't need to use this directly.
 */
export class StellarAdapter implements IAdapter {
  private _network: StellarSupportedNetwork;
  private _rpcUrl: string;
  private _networkPassphrase: string;
  private _keypair: Keypair | null;
  private _externalSigner: StellarExternalSigner | null;
  private _factoryAddress: string | null;
  private _nftFactoryAddress: string | null;
  private _multiTokenFactoryAddress: string | null;
  private _escrowFactoryAddress: string | null;
  private _rampSettlementFactoryAddress: string | null;

  constructor(network: StellarSupportedNetwork, config: StellarAnkaraChainConfig) {
    const networkConfig = getNetwork(network);
    if (networkConfig.chainFamily !== "stellar") {
      throw new Error(`StellarAdapter constructed with a non-Stellar network: ${network}`);
    }
    this._network = network;
    this._rpcUrl = config.rpcUrl ?? networkConfig.rpcUrl;
    this._networkPassphrase = networkConfig.networkPassphrase;
    this._keypair = config.stellarSecretKey ? Keypair.fromSecret(config.stellarSecretKey) : null;
    this._externalSigner = config.stellarSecretKey ? null : (config.stellarSigner ?? null);
    this._factoryAddress = config.factoryAddress ?? null;
    this._nftFactoryAddress = config.nftFactoryAddress ?? null;
    this._multiTokenFactoryAddress = config.multiTokenFactoryAddress ?? null;
    this._escrowFactoryAddress = config.escrowFactoryAddress ?? null;
    this._rampSettlementFactoryAddress = config.rampSettlementFactoryAddress ?? null;
  }

  // ─── Connection helpers ───────────────────────────────────────────────────

  get network(): StellarSupportedNetwork { return this._network; }
  get rpcUrl(): string { return this._rpcUrl; }
  get networkPassphrase(): string { return this._networkPassphrase; }

  private keypair(): Keypair {
    if (!this._keypair) throw new Error("No Stellar secret key configured. Pass stellarSecretKey to Ankara Chain.");
    return this._keypair;
  }

  private signerPublicKey(): string {
    const pk = this._keypair?.publicKey() ?? this._externalSigner?.publicKey;
    if (!pk) throw new Error("No Stellar signer configured. Pass stellarSecretKey or stellarSigner to Ankara Chain.");
    return pk;
  }

  get factoryAddress(): string {
    if (!this._factoryAddress) throw new Error("No factory address configured.");
    return this._factoryAddress;
  }
  setFactoryAddress(address: string) { this._factoryAddress = address; }

  get nftFactoryAddress(): string {
    if (!this._nftFactoryAddress) throw new Error("No NFT factory address configured.");
    return this._nftFactoryAddress;
  }
  setNftFactoryAddress(address: string) { this._nftFactoryAddress = address; }

  get multiTokenFactoryAddress(): string {
    if (!this._multiTokenFactoryAddress) throw new Error("No multi-token factory address configured.");
    return this._multiTokenFactoryAddress;
  }
  setMultiTokenFactoryAddress(address: string) { this._multiTokenFactoryAddress = address; }

  get escrowFactoryAddress(): string {
    if (!this._escrowFactoryAddress) throw new Error("No escrow factory address configured.");
    return this._escrowFactoryAddress;
  }
  setEscrowFactoryAddress(address: string) { this._escrowFactoryAddress = address; }

  get rampSettlementFactoryAddress(): string {
    if (!this._rampSettlementFactoryAddress) throw new Error("No ramp settlement factory address configured.");
    return this._rampSettlementFactoryAddress;
  }
  setRampSettlementFactoryAddress(address: string) { this._rampSettlementFactoryAddress = address; }

  async getSignerAddress(): Promise<string> {
    return this.signerPublicKey();
  }

  /**
   * Native XLM balance, read directly from the account's ledger entry.
   *
   * The native asset's Stellar Asset Contract has no deployed WASM to
   * introspect (it's a built-in executable, not a user contract), so routing
   * this through the dynamic `contract.Client` machinery like every other
   * contract call — the original approach here — fails outright: fetching
   * its "spec" via `getContractWasmByContractId` throws trying to read a
   * `wasmHash()` off a union arm that isn't `ContractExecutableWasm`. Native
   * XLM balance is a field on the account entry itself, not token-contract
   * state, so it's read that way instead.
   */
  async getBalance(address?: string): Promise<string> {
    const addr = address ?? await this.getSignerAddress();
    const server = new rpc.Server(this._rpcUrl);
    const account = await server.getAccountEntry(addr);
    const stroops = BigInt(account.balance().toString());
    return (Number(stroops) / STROOP).toString();
  }

  // ─── Dynamic contract client ──────────────────────────────────────────────

  private async clientFor(contractId: string): Promise<DynamicClient> {
    const options: ClientOptions = {
      contractId,
      networkPassphrase: this._networkPassphrase,
      rpcUrl: this._rpcUrl,
    };
    if (this._keypair) {
      options.publicKey = this._keypair.publicKey();
      const signer = basicNodeSigner(this._keypair, this._networkPassphrase);
      options.signTransaction = signer.signTransaction;
      options.signAuthEntry = signer.signAuthEntry;
    } else if (this._externalSigner) {
      options.publicKey = this._externalSigner.publicKey;
      options.signTransaction = this._externalSigner.signTransaction;
      if (this._externalSigner.signAuthEntry) options.signAuthEntry = this._externalSigner.signAuthEntry;
    }
    const client = await StellarContractClient.from(options);
    return client as unknown as DynamicClient;
  }

  private randomSalt(): Buffer {
    return randomBytes(32);
  }

  private async defaultPaymentToken(): Promise<string> {
    return Asset.native().contractId(this._networkPassphrase);
  }

  private async writeAndExtract<T>(
    contractId: string,
    method: string,
    args: Record<string, unknown>
  ): Promise<{ result: T; txHash: string }> {
    const client = await this.clientFor(contractId);
    const tx = await client[method](args);
    const sent = await tx.signAndSend();
    return {
      result: sent.result as T,
      txHash: sent.getTransactionResponse?.txHash ?? "",
    };
  }

  private async read<T>(
    contractId: string,
    method: string,
    args: Record<string, unknown>
  ): Promise<T> {
    const client = await this.clientFor(contractId);
    const tx = await client[method](args);
    return tx.result as T;
  }

  // ─── Fungible template deploys ────────────────────────────────────────────

  async deployFarmlandToken(opts: DeployFarmlandOptions): Promise<DeployResult> {
    const deployer = opts.admin ?? await this.getSignerAddress();
    const assetId = assetIdToBytes32(opts.assetId);
    const { result: tokenAddress, txHash } = await this.writeAndExtract<string>(
      this.factoryAddress,
      "deploy_farmland_token",
      {
        deployer,
        payment_token: await this.defaultPaymentToken(),
        salt: this.randomSalt(),
        name: opts.name,
        symbol: opts.symbol,
        asset_id: assetId,
        country_code: opts.countryCode,
        admin: deployer,
        verifier: opts.identityVerifier,
        metadata: {
          location: opts.metadata.location,
          area_sq_meters: opts.metadata.areaSqMeters,
          soil_type: opts.metadata.soilType,
          irrigation_type: opts.metadata.irrigationType,
          crop_history: opts.metadata.cropHistory,
          title_document_hash: hexToBytes32(opts.metadata.titleDocumentHash),
          valuation_usd: opts.metadata.valuationUSD,
          state_region: opts.metadata.stateRegion,
          last_updated: opts.metadata.lastUpdated,
        },
      }
    );
    return {
      tokenAddress, txHash, assetId: opts.assetId, template: "farmland",
      network: this._network, deployedAt: Math.floor(Date.now() / 1000),
    };
  }

  async deployCommodityReceiptToken(opts: DeployCommodityOptions): Promise<DeployResult> {
    const deployer = opts.admin ?? await this.getSignerAddress();
    const assetId = assetIdToBytes32(opts.assetId);
    const { result: tokenAddress, txHash } = await this.writeAndExtract<string>(
      this.factoryAddress,
      "deploy_commodity_receipt_token",
      {
        deployer,
        payment_token: await this.defaultPaymentToken(),
        salt: this.randomSalt(),
        name: opts.name,
        symbol: opts.symbol,
        asset_id: assetId,
        country_code: opts.countryCode,
        admin: deployer,
        verifier: opts.identityVerifier,
        metadata: {
          commodity_type: opts.metadata.commodityType,
          quantity_kg: opts.metadata.quantityKg,
          grade_classification: opts.metadata.gradeClassification,
          warehouse_id: opts.metadata.warehouseId,
          warehouse_location: opts.metadata.warehouseLocation,
          deposit_date: opts.metadata.depositDate,
          expiry_date: opts.metadata.expiryDate,
          inspection_report_hash: hexToBytes32(opts.metadata.inspectionReportHash),
          valuation_usd: opts.metadata.valuationUSD,
          harvest_season: opts.metadata.harvestSeason,
          last_updated: opts.metadata.lastUpdated,
        },
      }
    );
    return {
      tokenAddress, txHash, assetId: opts.assetId, template: "commodity",
      network: this._network, deployedAt: Math.floor(Date.now() / 1000),
    };
  }

  async deployRealEstateToken(opts: DeployRealEstateOptions): Promise<DeployResult> {
    const deployer = opts.admin ?? await this.getSignerAddress();
    const assetId = assetIdToBytes32(opts.assetId);
    const { result: tokenAddress, txHash } = await this.writeAndExtract<string>(
      this.factoryAddress,
      "deploy_real_estate_token",
      {
        deployer,
        payment_token: await this.defaultPaymentToken(),
        salt: this.randomSalt(),
        name: opts.name,
        symbol: opts.symbol,
        asset_id: assetId,
        country_code: opts.countryCode,
        admin: deployer,
        verifier: opts.identityVerifier,
        metadata: {
          property_id: opts.metadata.propertyId,
          property_type: opts.metadata.propertyType,
          location_address: opts.metadata.locationAddress,
          total_area_sq_meters: opts.metadata.totalAreaSqMeters,
          title_document_hash: hexToBytes32(opts.metadata.titleDocumentHash),
          valuation_usd: opts.metadata.valuationUSD,
          rental_yield_bps: Number(opts.metadata.rentalYieldBps),
          occupancy_status: opts.metadata.occupancyStatus,
          developer_address: opts.metadata.developerAddress,
          last_updated: opts.metadata.lastUpdated,
        },
      }
    );
    return {
      tokenAddress, txHash, assetId: opts.assetId, template: "real-estate",
      network: this._network, deployedAt: Math.floor(Date.now() / 1000),
    };
  }

  async deployInvoiceToken(opts: DeployInvoiceOptions): Promise<DeployResult> {
    const deployer = opts.admin ?? await this.getSignerAddress();
    const assetId = assetIdToBytes32(opts.assetId);
    const { result: tokenAddress, txHash } = await this.writeAndExtract<string>(
      this.factoryAddress,
      "deploy_invoice_token",
      {
        deployer,
        payment_token: await this.defaultPaymentToken(),
        salt: this.randomSalt(),
        name: opts.name,
        symbol: opts.symbol,
        asset_id: assetId,
        country_code: opts.countryCode,
        admin: deployer,
        verifier: opts.identityVerifier,
        metadata: {
          invoice_number: opts.metadata.invoiceNumber,
          debtor_reference: opts.metadata.debtorReference,
          face_value_usd: opts.metadata.faceValueUSD,
          discount_rate_bps: Number(opts.metadata.discountRateBps),
          issuance_date: opts.metadata.issuanceDate,
          due_date: opts.metadata.dueDate,
          invoice_document_hash: hexToBytes32(opts.metadata.invoiceDocumentHash),
          currency: opts.metadata.currency,
          last_updated: opts.metadata.lastUpdated,
        },
      }
    );
    return {
      tokenAddress, txHash, assetId: opts.assetId, template: "invoice",
      network: this._network, deployedAt: Math.floor(Date.now() / 1000),
    };
  }

  async deployCarbonCreditToken(opts: DeployCarbonCreditOptions): Promise<DeployResult> {
    const deployer = opts.admin ?? await this.getSignerAddress();
    const assetId = assetIdToBytes32(opts.assetId);
    const { result: tokenAddress, txHash } = await this.writeAndExtract<string>(
      this.factoryAddress,
      "deploy_carbon_credit_token",
      {
        deployer,
        payment_token: await this.defaultPaymentToken(),
        salt: this.randomSalt(),
        name: opts.name,
        symbol: opts.symbol,
        asset_id: assetId,
        country_code: opts.countryCode,
        admin: deployer,
        verifier: opts.identityVerifier,
        metadata: {
          credit_type: opts.metadata.creditType,
          verification_body_ref: opts.metadata.verificationBodyRef,
          vintage_year: Number(opts.metadata.vintageYear),
          quantity_co2e: opts.metadata.quantityCO2e,
          project_location: opts.metadata.projectLocation,
          project_type: opts.metadata.projectType,
          verification_doc_hash: hexToBytes32(opts.metadata.verificationDocHash),
          last_updated: opts.metadata.lastUpdated,
        },
      }
    );
    return {
      tokenAddress, txHash, assetId: opts.assetId, template: "carbon-credit",
      network: this._network, deployedAt: Math.floor(Date.now() / 1000),
    };
  }

  async deployMiningRightsToken(opts: DeployMiningRightsOptions): Promise<DeployResult> {
    const deployer = opts.admin ?? await this.getSignerAddress();
    const assetId = assetIdToBytes32(opts.assetId);
    const { result: tokenAddress, txHash } = await this.writeAndExtract<string>(
      this.factoryAddress,
      "deploy_mining_rights_token",
      {
        deployer,
        payment_token: await this.defaultPaymentToken(),
        salt: this.randomSalt(),
        name: opts.name,
        symbol: opts.symbol,
        asset_id: assetId,
        country_code: opts.countryCode,
        admin: deployer,
        verifier: opts.identityVerifier,
        metadata: {
          license_number: opts.metadata.licenseNumber,
          mineral_type: opts.metadata.mineralType,
          concession_area: opts.metadata.concessionArea,
          area_hectares: opts.metadata.areaHectares,
          license_expiry: opts.metadata.licenseExpiry,
          issuing_authority: opts.metadata.issuingAuthority,
          license_document_hash: hexToBytes32(opts.metadata.licenseDocumentHash),
          royalty_rate_bps: Number(opts.metadata.royaltyRateBps),
          last_updated: opts.metadata.lastUpdated,
        },
      }
    );
    return {
      tokenAddress, txHash, assetId: opts.assetId, template: "mining-rights",
      network: this._network, deployedAt: Math.floor(Date.now() / 1000),
    };
  }

  async getDeployerTokens(address?: string): Promise<string[]> {
    const deployer = address ?? await this.getSignerAddress();
    return this.read<string[]>(this.factoryAddress, "get_deployer_tokens", { deployer });
  }

  async totalDeployed(): Promise<number> {
    return this.read<number>(this.factoryAddress, "total_deployed", {});
  }

  // ─── NFT template deploys ─────────────────────────────────────────────────

  async deployFarmlandNFT(opts: DeployFarmlandNFTOptions): Promise<NFTDeployResult> {
    const deployer = opts.admin ?? await this.getSignerAddress();
    const assetId = assetIdToBytes32(opts.assetId);
    const { result: nftAddress, txHash } = await this.writeAndExtract<string>(
      this.nftFactoryAddress,
      "deploy_farmland_nft",
      {
        deployer, payment_token: await this.defaultPaymentToken(), salt: this.randomSalt(),
        asset_id: assetId, country_code: opts.countryCode, admin: deployer,
        verifier: opts.identityVerifier,
      }
    );
    return {
      nftAddress, txHash, assetId: opts.assetId, template: "farmland-nft",
      network: this._network, deployedAt: Math.floor(Date.now() / 1000),
    };
  }

  async deployRealEstateNFT(opts: DeployRealEstateNFTOptions): Promise<NFTDeployResult> {
    const deployer = opts.admin ?? await this.getSignerAddress();
    const assetId = assetIdToBytes32(opts.assetId);
    const { result: nftAddress, txHash } = await this.writeAndExtract<string>(
      this.nftFactoryAddress,
      "deploy_real_estate_nft",
      {
        deployer, payment_token: await this.defaultPaymentToken(), salt: this.randomSalt(),
        asset_id: assetId, country_code: opts.countryCode, admin: deployer,
        verifier: opts.identityVerifier,
      }
    );
    return {
      nftAddress, txHash, assetId: opts.assetId, template: "real-estate-nft",
      network: this._network, deployedAt: Math.floor(Date.now() / 1000),
    };
  }

  async deployMiningRightsNFT(opts: DeployMiningRightsNFTOptions): Promise<NFTDeployResult> {
    const deployer = opts.admin ?? await this.getSignerAddress();
    const assetId = assetIdToBytes32(opts.assetId);
    const { result: nftAddress, txHash } = await this.writeAndExtract<string>(
      this.nftFactoryAddress,
      "deploy_mining_rights_nft",
      {
        deployer, payment_token: await this.defaultPaymentToken(), salt: this.randomSalt(),
        asset_id: assetId, country_code: opts.countryCode, admin: deployer,
        verifier: opts.identityVerifier,
      }
    );
    return {
      nftAddress, txHash, assetId: opts.assetId, template: "mining-rights-nft",
      network: this._network, deployedAt: Math.floor(Date.now() / 1000),
    };
  }

  async deployCommodityVaultNFT(opts: DeployCommodityVaultNFTOptions): Promise<NFTDeployResult> {
    const deployer = opts.admin ?? await this.getSignerAddress();
    const assetId = assetIdToBytes32(opts.assetId);
    const { result: nftAddress, txHash } = await this.writeAndExtract<string>(
      this.nftFactoryAddress,
      "deploy_commodity_vault_nft",
      {
        deployer, payment_token: await this.defaultPaymentToken(), salt: this.randomSalt(),
        asset_id: assetId, country_code: opts.countryCode, admin: deployer,
        verifier: opts.identityVerifier,
      }
    );
    return {
      nftAddress, txHash, assetId: opts.assetId, template: "commodity-vault-nft",
      network: this._network, deployedAt: Math.floor(Date.now() / 1000),
    };
  }

  async getDeployerNFTs(address?: string): Promise<string[]> {
    const deployer = address ?? await this.getSignerAddress();
    return this.read<string[]>(this.nftFactoryAddress, "get_deployer_nfts", { deployer });
  }

  async totalDeployedNFTs(): Promise<number> {
    return this.read<number>(this.nftFactoryAddress, "total_deployed", {});
  }

  // ─── Escrow ────────────────────────────────────────────────────────────────

  async deployEscrow(opts: DeployEscrowOptions): Promise<EscrowDeployResult> {
    const deployer = opts.admin ?? await this.getSignerAddress();
    const amounts = opts.milestones.map((m) => m.amount);
    const descriptionHashes = opts.milestones.map((m) =>
      hexToBytes32(m.descriptionHash ?? "0x" + "0".repeat(64))
    );
    const totalAmount = amounts.reduce((sum, a) => sum + a, 0n);

    const { result: escrowAddress, txHash } = await this.writeAndExtract<string>(
      this.escrowFactoryAddress,
      "deploy_escrow",
      {
        deployer,
        payment_token: await this.defaultPaymentToken(),
        salt: this.randomSalt(),
        admin: deployer,
        payer: opts.payer,
        payee: opts.payee,
        arbiter: opts.arbiter,
        escrow_token: opts.token,
        identity_verifier: opts.identityVerifier,
        timelock_duration: BigInt(opts.timelockDurationSeconds ?? 0),
        amounts,
        description_hashes: descriptionHashes,
      }
    );
    return {
      escrowAddress, txHash, payer: opts.payer, payee: opts.payee, token: opts.token,
      totalAmount, network: this._network, deployedAt: Math.floor(Date.now() / 1000),
    };
  }

  async getDeployerEscrows(address?: string): Promise<string[]> {
    const deployer = address ?? await this.getSignerAddress();
    return this.read<string[]>(this.escrowFactoryAddress, "get_deployer_escrows", { deployer });
  }

  async totalDeployedEscrows(): Promise<number> {
    return this.read<number>(this.escrowFactoryAddress, "total_deployed", {});
  }

  // ─── Milestone escrow lifecycle (IAdapter) ──────────────────────────────
  // `fund`/`mark_delivered`/`approve_milestone`/`raise_dispute`/
  // `resolve_dispute`/`vote_cancel` all take an explicit `caller: Address`
  // param on the Soroban side (there's no implicit `msg.sender`) — always
  // the adapter's own configured signer, matching whichever party that
  // signer represents for this deal. The rest (`claim_timelock_release`,
  // `set_arbiter`, `set_identity_verifier`, `pause`/`unpause`) enforce their
  // own role/party checks internally via `require_auth()` on a stored
  // address, so they need no caller argument here.

  async escrowFund(escrowAddress: string, milestoneId: number): Promise<string> {
    const caller = await this.getSignerAddress();
    const { txHash } = await this.writeAndExtract<void>(escrowAddress, "fund", {
      caller, milestone_id: milestoneId,
    });
    return txHash;
  }

  async escrowMarkDelivered(escrowAddress: string, milestoneId: number): Promise<string> {
    const caller = await this.getSignerAddress();
    const { txHash } = await this.writeAndExtract<void>(escrowAddress, "mark_delivered", {
      caller, milestone_id: milestoneId,
    });
    return txHash;
  }

  async escrowApproveMilestone(escrowAddress: string, milestoneId: number): Promise<string> {
    const caller = await this.getSignerAddress();
    const { txHash } = await this.writeAndExtract<void>(escrowAddress, "approve_milestone", {
      caller, milestone_id: milestoneId,
    });
    return txHash;
  }

  async escrowRaiseDispute(escrowAddress: string, milestoneId: number): Promise<string> {
    const caller = await this.getSignerAddress();
    const { txHash } = await this.writeAndExtract<void>(escrowAddress, "raise_dispute", {
      caller, milestone_id: milestoneId,
    });
    return txHash;
  }

  async escrowResolveDispute(escrowAddress: string, milestoneId: number, releaseToPayee: boolean): Promise<string> {
    const caller = await this.getSignerAddress();
    const { txHash } = await this.writeAndExtract<void>(escrowAddress, "resolve_dispute", {
      caller, milestone_id: milestoneId, release_to_payee: releaseToPayee,
    });
    return txHash;
  }

  async escrowClaimTimelockRelease(escrowAddress: string, milestoneId: number): Promise<string> {
    const { txHash } = await this.writeAndExtract<void>(escrowAddress, "claim_timelock_release", {
      milestone_id: milestoneId,
    });
    return txHash;
  }

  async escrowVoteCancel(escrowAddress: string): Promise<string> {
    const caller = await this.getSignerAddress();
    const { txHash } = await this.writeAndExtract<void>(escrowAddress, "vote_cancel", { caller });
    return txHash;
  }

  async escrowSetArbiter(escrowAddress: string, newArbiter: string): Promise<string> {
    const { txHash } = await this.writeAndExtract<void>(escrowAddress, "set_arbiter", {
      new_arbiter: newArbiter,
    });
    return txHash;
  }

  async escrowSetIdentityVerifier(escrowAddress: string, verifierAddress: string): Promise<string> {
    const { txHash } = await this.writeAndExtract<void>(escrowAddress, "set_identity_verifier", {
      new_verifier: verifierAddress,
    });
    return txHash;
  }

  async escrowPause(escrowAddress: string): Promise<string> {
    const { txHash } = await this.writeAndExtract<void>(escrowAddress, "pause", {});
    return txHash;
  }

  async escrowUnpause(escrowAddress: string): Promise<string> {
    const { txHash } = await this.writeAndExtract<void>(escrowAddress, "unpause", {});
    return txHash;
  }

  /**
   * Full on-chain event history for a deployed escrow, oldest first.
   *
   * `getEvents` turned out to be unreliable over a single wide ledger range
   * in practice — empirically, a 5,000-ledger window found a known event
   * while a *wider* 17,280-ledger window covering that same ledger found
   * nothing. The public RPC evidently has some internal per-call scan budget
   * it silently gives up within rather than erroring, so a single "start at
   * the oldest retained ledger" call cannot be trusted to surface everything.
   * Splitting the scan into small sequential chunks is the workaround; this
   * also bounds the lookback to `MAX_LOOKBACK_LEDGERS` rather than the full
   * ~7-day retention window, since scanning that in ~5,000-ledger chunks
   * would mean two dozen-plus sequential round trips for what this dashboard
   * actually needs (a freshly-created test deal's history) — a long-lived
   * deal's older activity would need a real indexer, not a client-side scan.
   */
  async escrowGetActivity(escrowAddress: string): Promise<EscrowActivityEvent[]> {
    const server = new rpc.Server(this._rpcUrl);
    const { oldestLedger, latestLedger } = await server.getHealth();

    const CHUNK_SIZE = 5_000;
    const MAX_LOOKBACK_LEDGERS = 50_000; // ~3 days at ~5s/ledger
    const scanFrom = Math.max(oldestLedger, latestLedger - MAX_LOOKBACK_LEDGERS);

    const events: Awaited<ReturnType<typeof server.getEvents>>["events"] = [];
    for (let start = scanFrom; start <= latestLedger; start += CHUNK_SIZE) {
      const end = Math.min(start + CHUNK_SIZE - 1, latestLedger);
      const chunk = await server.getEvents({
        startLedger: start,
        endLedger: end,
        filters: [{ type: "contract", contractIds: [escrowAddress] }],
      });
      events.push(...chunk.events);
    }

    const activity: EscrowActivityEvent[] = [];
    for (const event of events) {
      const [label, milestoneArg] = event.topic.map(t => scValToNative(t)) as [string, number | undefined];
      const value = scValToNative(event.value);
      const base = {
        txHash: event.txHash,
        timestamp: Math.floor(new Date(event.ledgerClosedAt).getTime() / 1000),
      };

      let parsed: EscrowActivityEvent | null;
      switch (label) {
        case "funded":    parsed = { ...base, type: "funded", milestoneId: Number(milestoneArg), data: { amount: value } }; break;
        case "delivered": parsed = { ...base, type: "delivered", milestoneId: Number(milestoneArg) }; break;
        case "released": {
          const [amount, viaTimelock] = value as [bigint, boolean];
          parsed = { ...base, type: "released", milestoneId: Number(milestoneArg), data: { amount, viaTimelock } };
          break;
        }
        case "disputed":  parsed = { ...base, type: "disputed", milestoneId: Number(milestoneArg), data: { raisedBy: value } }; break;
        case "resolved":  parsed = { ...base, type: "resolved", milestoneId: Number(milestoneArg), data: { releaseToPayee: value } }; break;
        case "refunded":  parsed = { ...base, type: "refunded", milestoneId: Number(milestoneArg), data: { amount: value } }; break;
        case "cancelvot": parsed = { ...base, type: "cancel-vote", data: { caller: value } }; break;
        case "cancelled": parsed = { ...base, type: "cancelled", data: { refundedAmount: value } }; break;
        case "arbiter":   parsed = { ...base, type: "arbiter-changed", data: { newArbiter: value } }; break;
        default:          parsed = null;
      }
      if (parsed) activity.push(parsed);
    }

    activity.sort((a, b) => a.timestamp - b.timestamp);
    return activity;
  }

  async escrowGetPayer(escrowAddress: string): Promise<string> {
    return this.read<string>(escrowAddress, "payer", {});
  }

  async escrowGetPayee(escrowAddress: string): Promise<string> {
    return this.read<string>(escrowAddress, "payee", {});
  }

  async escrowGetArbiter(escrowAddress: string): Promise<string> {
    return this.read<string>(escrowAddress, "arbiter", {});
  }

  async escrowGetToken(escrowAddress: string): Promise<string> {
    return this.read<string>(escrowAddress, "token", {});
  }

  async escrowGetTotalAmount(escrowAddress: string): Promise<bigint> {
    return this.read<bigint>(escrowAddress, "total_amount", {});
  }

  async escrowIsFunded(escrowAddress: string): Promise<boolean> {
    return this.read<boolean>(escrowAddress, "funded", {});
  }

  async escrowIsCancelled(escrowAddress: string): Promise<boolean> {
    return this.read<boolean>(escrowAddress, "cancelled", {});
  }

  async escrowMilestoneCount(escrowAddress: string): Promise<number> {
    return this.read<number>(escrowAddress, "milestone_count", {});
  }

  async escrowGetMilestone(escrowAddress: string, milestoneId: number): Promise<Milestone> {
    const m = await this.read<{
      amount: bigint;
      description_hash: Buffer;
      status: unknown;
      delivered_at: bigint;
      funded: boolean;
    }>(escrowAddress, "get_milestone", { milestone_id: milestoneId });
    return {
      amount: m.amount,
      descriptionHash: "0x" + Buffer.from(m.description_hash).toString("hex"),
      status: decodeStatusEnum(MilestoneStatus, m.status),
      deliveredAt: m.delivered_at,
      funded: m.funded,
    };
  }

  async escrowRemainingBalance(escrowAddress: string): Promise<bigint> {
    return this.read<bigint>(escrowAddress, "remaining_balance", {});
  }

  // ─── Ramp settlement ─────────────────────────────────────────────────────

  async deployRampSettlement(opts: DeployRampSettlementOptions): Promise<RampSettlementDeployResult> {
    const deployer = opts.admin ?? await this.getSignerAddress();
    const { result: settlementAddress, txHash } = await this.writeAndExtract<string>(
      this.rampSettlementFactoryAddress,
      "deploy_ramp_settlement",
      {
        deployer,
        payment_token: await this.defaultPaymentToken(),
        salt: this.randomSalt(),
        admin: deployer,
        treasury: opts.treasury,
      }
    );
    return {
      settlementAddress, txHash, treasury: opts.treasury,
      network: this._network, deployedAt: Math.floor(Date.now() / 1000),
    };
  }

  async getDeployerRampSettlements(address?: string): Promise<string[]> {
    const deployer = address ?? await this.getSignerAddress();
    return this.read<string[]>(
      this.rampSettlementFactoryAddress,
      "get_deployer_settlements",
      { deployer }
    );
  }

  async totalDeployedRampSettlements(): Promise<number> {
    return this.read<number>(this.rampSettlementFactoryAddress, "total_deployed", {});
  }

  // ─── Ramp settlement lifecycle (IAdapter) ───────────────────────────────
  // `confirm_off_ramp_settlement`/`refund_off_ramp`/`record_on_ramp_settlement`
  // enforce Settler/Manager role checks internally via `require_auth()` on
  // the stored role address — no explicit caller argument needed, same as
  // the escrow admin-only methods above.

  async rampDepositOffRamp(
    settlementAddress: string,
    referenceId: string,
    tokenAddress: string,
    amount: bigint
  ): Promise<string> {
    const caller = await this.getSignerAddress();
    const { txHash } = await this.writeAndExtract<void>(settlementAddress, "initiate_off_ramp", {
      caller,
      reference_id: assetIdToBytes32(referenceId),
      token: tokenAddress,
      amount,
      provider_ref: referenceId,
    });
    return txHash;
  }

  async rampConfirmOffRampSettlement(settlementAddress: string, referenceId: string): Promise<string> {
    const { txHash } = await this.writeAndExtract<void>(
      settlementAddress,
      "confirm_off_ramp_settlement",
      { reference_id: assetIdToBytes32(referenceId) }
    );
    return txHash;
  }

  async rampRefundOffRamp(settlementAddress: string, referenceId: string): Promise<string> {
    const { txHash } = await this.writeAndExtract<void>(settlementAddress, "refund_off_ramp", {
      reference_id: assetIdToBytes32(referenceId),
    });
    return txHash;
  }

  async rampRecordOnRampSettlement(
    settlementAddress: string,
    referenceId: string,
    recipient: string,
    tokenAddress: string,
    amount: bigint
  ): Promise<string> {
    const { txHash } = await this.writeAndExtract<void>(
      settlementAddress,
      "record_on_ramp_settlement",
      {
        reference_id: assetIdToBytes32(referenceId),
        recipient,
        token: tokenAddress,
        amount,
        provider_ref: referenceId,
      }
    );
    return txHash;
  }

  async rampGetOffRampDeposit(settlementAddress: string, referenceId: string): Promise<OffRampDeposit> {
    const d = await this.read<{
      depositor: string;
      token: string;
      amount: bigint;
      status: unknown;
      initiated_at: bigint;
    } | null>(settlementAddress, "get_off_ramp", { reference_id: assetIdToBytes32(referenceId) });
    if (!d) {
      throw new Error(`No off-ramp deposit found for reference: ${referenceId}`);
    }
    return {
      depositor: d.depositor,
      token: d.token,
      amount: d.amount,
      status: decodeStatusEnum(RampSettlementStatus, d.status),
      initiatedAt: d.initiated_at,
    };
  }

  async rampGetOnRampRecord(settlementAddress: string, referenceId: string): Promise<OnRampRecord> {
    const r = await this.read<{
      recipient: string;
      token: string;
      amount: bigint;
      status: unknown;
      recorded_at: bigint;
    } | null>(settlementAddress, "get_on_ramp", { reference_id: assetIdToBytes32(referenceId) });
    if (!r) {
      throw new Error(`No on-ramp record found for reference: ${referenceId}`);
    }
    return {
      recipient: r.recipient,
      token: r.token,
      amount: r.amount,
      status: decodeStatusEnum(RampSettlementStatus, r.status),
      recordedAt: r.recorded_at,
    };
  }

  // ─── Multi-token (ERC-1155 equivalent) + PoolVault ──────────────────────

  async deployCommodityBatchToken(opts: DeployCommodityBatchOptions): Promise<MultiTokenDeployResult> {
    const deployer = opts.admin ?? await this.getSignerAddress();
    const { result: contractAddress, txHash } = await this.writeAndExtract<string>(
      this.multiTokenFactoryAddress,
      "deploy_commodity_batch_token",
      {
        deployer,
        payment_token: await this.defaultPaymentToken(),
        salt: this.randomSalt(),
        name: opts.name,
        country_code: opts.countryCode,
        base_uri: opts.baseURI,
        admin: deployer,
        warehouse: {
          warehouse_id: opts.warehouse.warehouseId,
          warehouse_location: opts.warehouse.warehouseLocation,
          operator_address: opts.warehouse.operatorAddress ?? deployer,
          warehouse_license_hash: hexToBytes32(
            opts.warehouse.warehouseLicenseHash ?? "0x" + "0".repeat(64)
          ),
          certification_expiry: opts.warehouse.certificationExpiry ?? 9_999_999_999n,
        },
      }
    );
    return {
      contractAddress, txHash, template: "commodity-batch",
      network: this._network, deployedAt: Math.floor(Date.now() / 1000),
    };
  }

  async deployPoolVault(opts: DeployPoolVaultOptions): Promise<MultiTokenDeployResult> {
    const deployer = opts.admin ?? await this.getSignerAddress();
    const assetId = assetIdToBytes32(opts.assetId);
    const { result: contractAddress, txHash } = await this.writeAndExtract<string>(
      this.multiTokenFactoryAddress,
      "deploy_pool_vault",
      {
        deployer,
        payment_token: await this.defaultPaymentToken(),
        salt: this.randomSalt(),
        name: opts.name,
        symbol: opts.symbol,
        asset_id: assetId,
        country_code: opts.countryCode,
        admin: deployer,
        verifier: opts.identityVerifier,
        oracle: opts.oracle,
        management_fee_bps: opts.managementFeeBps ?? 0,
      }
    );
    return {
      contractAddress, txHash, template: "pool-vault",
      network: this._network, deployedAt: Math.floor(Date.now() / 1000),
    };
  }

  async getDeployerMultiTokens(address?: string): Promise<string[]> {
    const deployer = address ?? await this.getSignerAddress();
    return this.read<string[]>(
      this.multiTokenFactoryAddress,
      "get_deployer_tokens",
      { deployer }
    );
  }

  async totalDeployedMultiTokens(): Promise<number> {
    return this.read<number>(this.multiTokenFactoryAddress, "total_deployed", {});
  }

  // ─── Generic token operations ─────────────────────────────────────────────

  async mintTokens(tokenAddress: string, to: string, amount: bigint): Promise<string> {
    const { txHash } = await this.writeAndExtract<void>(tokenAddress, "mint", { to, amount });
    return txHash;
  }

  async getBalance2(tokenAddress: string, walletAddress: string): Promise<bigint> {
    return this.read<bigint>(tokenAddress, "balance", { id: walletAddress });
  }

  /**
   * Reads name/symbol/decimals via a raw simulated invocation rather than
   * `this.read()`'s dynamic `contract.Client` — every Stellar Asset Contract
   * (native XLM's wrapper included, not just custom-issued assets wrapped via
   * `stellar contract asset deploy`) uses a built-in executable with no
   * deployed WASM, so `Client.from()`'s WASM-fetch-based method discovery
   * fails for *all* of them, the same underlying issue `getBalance()` above
   * had to work around. A hand-built call sidesteps that entirely: SEP-41's
   * method shapes are fixed, so there's nothing to discover.
   */
  async genericGetTokenMetadata(tokenAddress: string): Promise<TokenMetadata> {
    const server = new rpc.Server(this._rpcUrl);
    const sourcePublicKey = this.signerPublicKey();
    const sourceAccountEntry = await server.getAccountEntry(sourcePublicKey);
    const contract = new Contract(tokenAddress);

    const call = async (method: string): Promise<unknown> => {
      const account = new Account(sourcePublicKey, sourceAccountEntry.seqNum().toString());
      const tx = new TransactionBuilder(account, { fee: "100", networkPassphrase: this._networkPassphrase })
        .addOperation(contract.call(method))
        .setTimeout(30)
        .build();
      const sim = await server.simulateTransaction(tx);
      if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) {
        throw new Error(`${tokenAddress} does not implement ${method}() — not a valid token contract`);
      }
      return scValToNative(sim.result.retval);
    };

    const [name, symbol, decimals] = await Promise.all([call("name"), call("symbol"), call("decimals")]);
    return { name: name as string, symbol: symbol as string, decimals: Number(decimals) };
  }

  // ─── AssetRegistry (IAdapter) ────────────────────────────────────────────
  // Unlike EVMAdapter, no per-template contract handle is needed here — the
  // dynamic Soroban `Client` fetches each deployed contract's own spec by
  // address, so `template` is only used to decode `get_metadata`'s
  // template-specific (snake_case) struct shape into the SDK's camelCase type.

  async assetGetName(tokenAddress: string): Promise<string> {
    return this.read<string>(tokenAddress, "name", {});
  }

  async assetGetSymbol(tokenAddress: string): Promise<string> {
    return this.read<string>(tokenAddress, "symbol", {});
  }

  async assetGetTotalSupply(tokenAddress: string): Promise<bigint> {
    return this.read<bigint>(tokenAddress, "total_supply", {});
  }

  async assetGetBalanceOf(tokenAddress: string, _template: AssetTemplate, holderAddress: string): Promise<bigint> {
    return this.read<bigint>(tokenAddress, "balance", { id: holderAddress });
  }

  async assetGetStatus(tokenAddress: string): Promise<AssetStatus> {
    const s = await this.read<unknown>(tokenAddress, "status", {});
    return decodeStatusEnum(AssetStatus, s);
  }

  async assetGetCountryCode(tokenAddress: string): Promise<string> {
    return this.read<string>(tokenAddress, "country_code", {});
  }

  async assetGetIdentityVerifier(tokenAddress: string): Promise<string> {
    const v = await this.read<string | null>(tokenAddress, "identity_verifier", {});
    return v ?? "";
  }

  async assetGetVersion(tokenAddress: string): Promise<number> {
    const v = await this.read<number>(tokenAddress, "metadata_version", {});
    return Number(v);
  }

  async assetGetMetadata(tokenAddress: string, template: AssetTemplate): Promise<AnyAssetMetadata> {
    const raw = await this.read<Record<string, unknown>>(tokenAddress, "get_metadata", {});
    return this._fromRawAssetMetadata(template, raw);
  }

  async assetSetStatus(tokenAddress: string, _template: AssetTemplate, newStatus: AssetStatus): Promise<string> {
    const { txHash } = await this.writeAndExtract<void>(tokenAddress, "set_status", {
      new_status: encodeStatusEnum(AssetStatus, newStatus),
    });
    return txHash;
  }

  async assetSetIdentityVerifier(tokenAddress: string, _template: AssetTemplate, verifierAddress: string): Promise<string> {
    const { txHash } = await this.writeAndExtract<void>(tokenAddress, "set_identity_verifier", { new_verifier: verifierAddress });
    return txHash;
  }

  async assetMint(tokenAddress: string, _template: AssetTemplate, to: string, amount: bigint): Promise<string> {
    const { txHash } = await this.writeAndExtract<void>(tokenAddress, "mint", { to, amount });
    return txHash;
  }

  async assetPause(tokenAddress: string): Promise<string> {
    const { txHash } = await this.writeAndExtract<void>(tokenAddress, "pause", {});
    return txHash;
  }

  async assetUnpause(tokenAddress: string): Promise<string> {
    const { txHash } = await this.writeAndExtract<void>(tokenAddress, "unpause", {});
    return txHash;
  }

  async assetGetValuationUSD(tokenAddress: string): Promise<bigint> {
    return this.read<bigint>(tokenAddress, "valuation_usd", {});
  }

  async assetUpdateValuation(tokenAddress: string, _template: AssetTemplate, newValuationUSD: bigint): Promise<string> {
    const { txHash } = await this.writeAndExtract<void>(tokenAddress, "update_valuation", { new_valuation_usd: newValuationUSD });
    return txHash;
  }

  async assetUpdateOccupancyStatus(tokenAddress: string, newStatus: string): Promise<string> {
    const { txHash } = await this.writeAndExtract<void>(tokenAddress, "update_occupancy_status", { new_status: newStatus });
    return txHash;
  }

  async assetDeclareRentalDistribution(tokenAddress: string, amountUSD: bigint): Promise<string> {
    const { txHash } = await this.writeAndExtract<void>(tokenAddress, "declare_rental_distribution", { amount_usd: amountUSD });
    return txHash;
  }

  async assetIsExpired(tokenAddress: string): Promise<boolean> {
    return this.read<boolean>(tokenAddress, "is_expired", {});
  }

  async assetMarkExpired(tokenAddress: string): Promise<string> {
    const { txHash } = await this.writeAndExtract<void>(tokenAddress, "mark_expired", {});
    return txHash;
  }

  async assetGetInvoiceStatus(tokenAddress: string): Promise<InvoiceStatus> {
    const s = await this.read<unknown>(tokenAddress, "invoice_status", {});
    return decodeStatusEnum(InvoiceStatus, s);
  }

  async assetIsOverdue(tokenAddress: string): Promise<boolean> {
    return this.read<boolean>(tokenAddress, "is_overdue", {});
  }

  async assetMarkFunded(tokenAddress: string): Promise<string> {
    const { txHash } = await this.writeAndExtract<void>(tokenAddress, "mark_funded", {});
    return txHash;
  }

  async assetMarkRepaid(tokenAddress: string): Promise<string> {
    const { txHash } = await this.writeAndExtract<void>(tokenAddress, "mark_repaid", {});
    return txHash;
  }

  async assetMarkDefaulted(tokenAddress: string, reason: string): Promise<string> {
    const { txHash } = await this.writeAndExtract<void>(tokenAddress, "mark_defaulted", { reason });
    return txHash;
  }

  async assetRetire(tokenAddress: string, amount: bigint, beneficiary: string, note: string): Promise<string> {
    const retiredBy = await this.getSignerAddress();
    const { txHash } = await this.writeAndExtract<void>(tokenAddress, "retire", {
      retired_by: retiredBy, amount, beneficiary, note,
    });
    return txHash;
  }

  async assetGetTotalRetired(tokenAddress: string): Promise<bigint> {
    return this.read<bigint>(tokenAddress, "total_retired", {});
  }

  async assetGetTotalRetirements(tokenAddress: string): Promise<number> {
    const n = await this.read<number>(tokenAddress, "total_retirements", {});
    return Number(n);
  }

  async assetGetRetirement(tokenAddress: string, index: number): Promise<RetirementRecord> {
    const r = await this.read<{
      retired_by: string;
      amount: bigint;
      timestamp: bigint;
      beneficiary: string;
      retirement_note: string;
    }>(tokenAddress, "get_retirement", { index });
    return {
      retiredBy: r.retired_by,
      amount: r.amount,
      timestamp: r.timestamp,
      beneficiary: r.beneficiary,
      retirementNote: r.retirement_note,
    };
  }

  async assetIsLicenseExpired(tokenAddress: string): Promise<boolean> {
    return this.read<boolean>(tokenAddress, "is_license_expired", {});
  }

  async assetRenewLicense(tokenAddress: string, newExpiry: bigint): Promise<string> {
    const { txHash } = await this.writeAndExtract<void>(tokenAddress, "renew_license", { new_expiry: newExpiry });
    return txHash;
  }

  async assetMarkLicenseExpired(tokenAddress: string): Promise<string> {
    const { txHash } = await this.writeAndExtract<void>(tokenAddress, "mark_license_expired", {});
    return txHash;
  }

  async assetDeclareRoyalty(tokenAddress: string, extractionValueUSD: bigint): Promise<string> {
    const { txHash } = await this.writeAndExtract<void>(tokenAddress, "declare_royalty", { extraction_value_usd: extractionValueUSD });
    return txHash;
  }

  async assetGetTokenMetadata(nftAddress: string, _nftTemplate: NFTAssetTemplate, tokenId: number): Promise<unknown> {
    return this.read<unknown>(nftAddress, "get_metadata", { token_id: tokenId });
  }

  async assetGetTokenVersion(nftAddress: string, _nftTemplate: NFTAssetTemplate, tokenId: number): Promise<number> {
    const v = await this.read<number>(nftAddress, "metadata_version", { token_id: tokenId });
    return Number(v);
  }

  async assetOwnerOf(nftAddress: string, _nftTemplate: NFTAssetTemplate, tokenId: number): Promise<string> {
    return this.read<string>(nftAddress, "owner_of", { token_id: tokenId });
  }

  async assetLinkToERC20(nftAddress: string, _nftTemplate: NFTAssetTemplate, erc20Address: string): Promise<string> {
    const { txHash } = await this.writeAndExtract<void>(nftAddress, "link_to_erc20", { erc20_address: erc20Address });
    return txHash;
  }

  // ─── CommodityBatchToken (IAdapter) ────────────────────────────────────────

  async batchRegister(contractAddress: string, batchId: bigint, metadata: BatchMetadata): Promise<string> {
    const { txHash } = await this.writeAndExtract<void>(contractAddress, "register_batch", {
      id: batchId,
      batch: {
        commodity_type: metadata.commodityType,
        quantity_kg: metadata.quantityKg,
        grade_classification: metadata.gradeClassification,
        deposit_date: metadata.depositDate,
        expiry_date: metadata.expiryDate,
        inspection_report_hash: hexToBytes32(metadata.inspectionReportHash),
        valuation_usd: metadata.valuationUSD,
        harvest_season: metadata.harvestSeason,
        origin_country: metadata.originCountry,
      },
    });
    return txHash;
  }

  async batchMint(contractAddress: string, batchId: bigint, to: string, amount: bigint): Promise<string> {
    const { txHash } = await this.writeAndExtract<void>(contractAddress, "mint", { to, id: batchId, amount });
    return txHash;
  }

  // ─── PoolVault (IAdapter) — `deposit`/`withdraw` take an explicit
  // `investor: Address` param on the Soroban side; auth is enforced by the
  // nested SEP-41 transfer (deposit) / burn (withdraw) requiring that
  // address's own auth, same pattern as escrow's `fund()`. ────────────────

  async poolDeposit(vaultAddress: string, tokenAddress: string, amount: bigint): Promise<string> {
    const investor = await this.getSignerAddress();
    const { txHash } = await this.writeAndExtract<void>(vaultAddress, "deposit", {
      investor, token_address: tokenAddress, amount,
    });
    return txHash;
  }

  async poolWithdraw(vaultAddress: string, poolTokenAmount: bigint): Promise<string> {
    const investor = await this.getSignerAddress();
    const { txHash } = await this.writeAndExtract<void>(vaultAddress, "withdraw", {
      investor, pool_token_amount: poolTokenAmount,
    });
    return txHash;
  }

  async poolGetStatus(vaultAddress: string): Promise<PoolVaultStatus> {
    const [name, symbol, totalSupply, navPerToken, totalAUM, managementFeeBps, acceptedTokens, lastFeeAccrual, oracle] =
      await Promise.all([
        this.read<string>(vaultAddress, "name", {}),
        this.read<string>(vaultAddress, "symbol", {}),
        this.read<bigint>(vaultAddress, "total_supply", {}),
        this.read<bigint>(vaultAddress, "nav_per_token", {}),
        this.read<bigint>(vaultAddress, "total_aum", {}),
        this.read<number>(vaultAddress, "management_fee_bps", {}),
        this.read<string[]>(vaultAddress, "accepted_tokens", {}),
        this.read<bigint>(vaultAddress, "last_fee_accrual", {}),
        this.read<string | null>(vaultAddress, "oracle", {}),
      ]);
    return {
      name, symbol, totalSupply, navPerToken, totalAUM,
      managementFeeBps: Number(managementFeeBps),
      acceptedTokens,
      lastFeeAccrual,
      oracle: oracle ?? "",
    };
  }

  // ─── ManualOracle (IAdapter) ────────────────────────────────────────────────

  async oracleSetPrice(oracleAddress: string, tokenAddress: string, priceUSD: bigint): Promise<string> {
    const { txHash } = await this.writeAndExtract<void>(oracleAddress, "set_price", {
      token: tokenAddress, price_usd: priceUSD,
    });
    return txHash;
  }

  // ─── CollateralVault (IAdapter) — `set_ltv_bps`/`set_liquidation_threshold_bps`
  // /`set_oracle`/`pause`/`unpause` enforce Role::Manager internally via
  // `require_auth()` on the stored role address, same as the escrow admin-only
  // methods above — no explicit caller argument needed. `loan_id` is a u64
  // on-chain, so it's passed as BigInt(...), same convention as
  // `timelock_duration` above. ──────────────────────────────────────────────

  async vaultOpenLoan(
    vaultAddress: string,
    collateralToken: string,
    collateralAmount: bigint,
    borrowAmount: bigint
  ): Promise<{ loanId: number; txHash: string }> {
    const caller = await this.getSignerAddress();
    const { result, txHash } = await this.writeAndExtract<bigint>(vaultAddress, "open_loan", {
      caller,
      collateral_token: collateralToken,
      collateral_amount: collateralAmount,
      borrow_amount: borrowAmount,
    });
    return { loanId: Number(result), txHash };
  }

  async vaultRepayLoan(vaultAddress: string, loanId: number): Promise<string> {
    const caller = await this.getSignerAddress();
    const { txHash } = await this.writeAndExtract<void>(vaultAddress, "repay_loan", {
      caller, loan_id: BigInt(loanId),
    });
    return txHash;
  }

  async vaultLiquidate(vaultAddress: string, loanId: number): Promise<string> {
    const { txHash } = await this.writeAndExtract<void>(vaultAddress, "liquidate", {
      loan_id: BigInt(loanId),
    });
    return txHash;
  }

  async vaultSetLtvBps(vaultAddress: string, newLtvBps: number): Promise<string> {
    const { txHash } = await this.writeAndExtract<void>(vaultAddress, "set_ltv_bps", {
      new_ltv_bps: newLtvBps,
    });
    return txHash;
  }

  async vaultSetLiquidationThresholdBps(vaultAddress: string, newThresholdBps: number): Promise<string> {
    const { txHash } = await this.writeAndExtract<void>(vaultAddress, "set_liquidation_threshold_bps", {
      new_threshold_bps: newThresholdBps,
    });
    return txHash;
  }

  async vaultSetOracle(vaultAddress: string, oracleAddress: string): Promise<string> {
    const { txHash } = await this.writeAndExtract<void>(vaultAddress, "set_oracle", {
      new_oracle: oracleAddress,
    });
    return txHash;
  }

  async vaultPause(vaultAddress: string): Promise<string> {
    const { txHash } = await this.writeAndExtract<void>(vaultAddress, "pause", {});
    return txHash;
  }

  async vaultUnpause(vaultAddress: string): Promise<string> {
    const { txHash } = await this.writeAndExtract<void>(vaultAddress, "unpause", {});
    return txHash;
  }

  async vaultGetLoan(vaultAddress: string, loanId: number): Promise<Loan> {
    const l = await this.read<{
      borrower: string;
      collateral_token: string;
      collateral_amount: bigint;
      borrowed_token: string;
      borrowed_amount: bigint;
      ltv_bps: number;
      opened_at: bigint;
      status: unknown;
    }>(vaultAddress, "get_loan", { loan_id: BigInt(loanId) });
    return {
      borrower: l.borrower,
      collateralToken: l.collateral_token,
      collateralAmount: l.collateral_amount,
      borrowedToken: l.borrowed_token,
      borrowedAmount: l.borrowed_amount,
      ltvBps: l.ltv_bps,
      openedAt: l.opened_at,
      status: decodeStatusEnum(LoanStatus, l.status),
    };
  }

  async vaultGetBorrowerLoans(vaultAddress: string, borrower?: string): Promise<number[]> {
    const addr = borrower ?? await this.getSignerAddress();
    const ids = await this.read<bigint[]>(vaultAddress, "get_borrower_loans", { borrower: addr });
    return ids.map((id) => Number(id));
  }

  async vaultCurrentLtvBps(vaultAddress: string, loanId: number): Promise<number> {
    return this.read<number>(vaultAddress, "current_ltv_bps", { loan_id: BigInt(loanId) });
  }

  async vaultIsLiquidatable(vaultAddress: string, loanId: number): Promise<boolean> {
    return this.read<boolean>(vaultAddress, "is_liquidatable", { loan_id: BigInt(loanId) });
  }

  async vaultGetBorrowedToken(vaultAddress: string): Promise<string> {
    return this.read<string>(vaultAddress, "borrowed_token", {});
  }

  async vaultGetOracle(vaultAddress: string): Promise<string> {
    return this.read<string>(vaultAddress, "oracle", {});
  }

  async vaultGetLtvBps(vaultAddress: string): Promise<number> {
    return this.read<number>(vaultAddress, "ltv_bps", {});
  }

  async vaultGetLiquidationThresholdBps(vaultAddress: string): Promise<number> {
    return this.read<number>(vaultAddress, "liquidation_threshold_bps", {});
  }

  async vaultIsPaused(vaultAddress: string): Promise<boolean> {
    return this.read<boolean>(vaultAddress, "is_paused", {});
  }

  // ─── Generic transfer (IAdapter) — `transfer` on a fungible SEP-41
  // contract takes `(from, to, amount)`; on an NFT contract it takes
  // `(from, to, token_id)`. Both require the caller's (`from`'s) auth,
  // enforced inside the contract itself. ──────────────────────────────────

  async genericTransferToken(tokenAddress: string, to: string, amount: bigint): Promise<string> {
    const from = await this.getSignerAddress();
    const { txHash } = await this.writeAndExtract<void>(tokenAddress, "transfer", { from, to, amount });
    return txHash;
  }

  async genericTransferNFT(nftAddress: string, to: string, tokenId: bigint): Promise<string> {
    const from = await this.getSignerAddress();
    const { txHash } = await this.writeAndExtract<void>(nftAddress, "transfer", { from, to, token_id: tokenId });
    return txHash;
  }

  private _fromRawAssetMetadata(template: AssetTemplate, raw: Record<string, unknown>): AnyAssetMetadata {
    const hex = (v: unknown) => "0x" + Buffer.from(v as ArrayLike<number>).toString("hex");
    switch (template) {
      case "farmland":
        return {
          location: raw.location as string,
          areaSqMeters: raw.area_sq_meters as bigint,
          soilType: raw.soil_type as string,
          irrigationType: raw.irrigation_type as string,
          cropHistory: raw.crop_history as string,
          titleDocumentHash: hex(raw.title_document_hash),
          valuationUSD: raw.valuation_usd as bigint,
          stateRegion: raw.state_region as string,
          lastUpdated: raw.last_updated as bigint,
        };
      case "commodity":
        return {
          commodityType: raw.commodity_type as string,
          quantityKg: raw.quantity_kg as bigint,
          gradeClassification: raw.grade_classification as string,
          warehouseId: raw.warehouse_id as string,
          warehouseLocation: raw.warehouse_location as string,
          depositDate: raw.deposit_date as bigint,
          expiryDate: raw.expiry_date as bigint,
          inspectionReportHash: hex(raw.inspection_report_hash),
          valuationUSD: raw.valuation_usd as bigint,
          harvestSeason: raw.harvest_season as string,
          lastUpdated: raw.last_updated as bigint,
        };
      case "real-estate":
        return {
          propertyId: raw.property_id as string,
          propertyType: raw.property_type as string,
          locationAddress: raw.location_address as string,
          totalAreaSqMeters: raw.total_area_sq_meters as bigint,
          titleDocumentHash: hex(raw.title_document_hash),
          valuationUSD: raw.valuation_usd as bigint,
          rentalYieldBps: BigInt(raw.rental_yield_bps as number),
          occupancyStatus: raw.occupancy_status as string,
          developerAddress: raw.developer_address as string,
          lastUpdated: raw.last_updated as bigint,
        };
      case "invoice":
        return {
          invoiceNumber: raw.invoice_number as string,
          debtorReference: raw.debtor_reference as string,
          faceValueUSD: raw.face_value_usd as bigint,
          discountRateBps: BigInt(raw.discount_rate_bps as number),
          issuanceDate: raw.issuance_date as bigint,
          dueDate: raw.due_date as bigint,
          invoiceDocumentHash: hex(raw.invoice_document_hash),
          currency: raw.currency as string,
          lastUpdated: raw.last_updated as bigint,
        };
      case "carbon-credit":
        return {
          creditType: raw.credit_type as string,
          verificationBodyRef: raw.verification_body_ref as string,
          vintageYear: BigInt(raw.vintage_year as number),
          quantityCO2e: raw.quantity_co2e as bigint,
          projectLocation: raw.project_location as string,
          projectType: raw.project_type as string,
          verificationDocHash: hex(raw.verification_doc_hash),
          lastUpdated: raw.last_updated as bigint,
        };
      case "mining-rights":
        return {
          licenseNumber: raw.license_number as string,
          mineralType: raw.mineral_type as string,
          concessionArea: raw.concession_area as string,
          areaHectares: raw.area_hectares as bigint,
          licenseExpiry: raw.license_expiry as bigint,
          issuingAuthority: raw.issuing_authority as string,
          licenseDocumentHash: hex(raw.license_document_hash),
          royaltyRateBps: BigInt(raw.royalty_rate_bps as number),
          lastUpdated: raw.last_updated as bigint,
        };
    }
  }
}
