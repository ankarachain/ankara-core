import { ethers, type Provider } from "ethers";
import { EVMAdapter } from "../adapters/evm";
import { StellarAdapter } from "../adapters/stellar";
import type { IAdapter } from "../adapters/IAdapter";
import { getNetwork } from "../utils/networks";
import type {
  AnkaraChainConfig,
  EVMAnkaraChainConfig,
  DeployFarmlandOptions,
  DeployCommodityOptions,
  DeployRealEstateOptions,
  DeployInvoiceOptions,
  DeployCarbonCreditOptions,
  DeployMiningRightsOptions,
  DeployResult,
  SupportedNetwork,
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
} from "../types";

/**
 * TokenFactory
 *
 * The primary entry point for deploying Ankara Chain RWA tokens.
 * Wraps the on-chain TokenFactory contract in a developer-friendly API.
 *
 * @example
 * ```typescript
 * import { TokenFactory } from "@ankarachain/sdk";
 * import { ethers } from "ethers";
 *
 * const provider = new ethers.JsonRpcProvider(rpcUrl);
 * const signer   = new ethers.Wallet(privateKey, provider);
 *
 * const factory = new TokenFactory({
 *   network: "polygon-amoy",
 *   signer,
 *   factoryAddress: "0xYourFactoryAddress",
 * });
 *
 * const result = await factory.deployFarmland({
 *   name: "Kano Farmland Token",
 *   symbol: "KFT",
 *   assetId: "KANO-FARM-001",
 *   countryCode: "NG",
 *   metadata: { ... },
 * });
 *
 * console.log("Deployed:", result.tokenAddress);
 * ```
 */
export class TokenFactory {
  private _adapter: IAdapter;

  constructor(config: AnkaraChainConfig) {
    if (config.network === "stellar" || config.network === "stellar-testnet") {
      this._adapter = new StellarAdapter(config.network, config);
      return;
    }

    // Every `SupportedNetwork` other than the two Stellar variants handled
    // above is an EVM network by construction, so this cast is backed by
    // that exhaustive check rather than an unchecked assumption.
    const evmConfig = config as EVMAnkaraChainConfig;
    const networkConfig = getNetwork(evmConfig.network);

    // Build provider
    const provider: Provider =
      evmConfig.provider ??
      new ethers.JsonRpcProvider(
        evmConfig.rpcUrl ?? networkConfig.rpcUrl,
        networkConfig.chainId
      );

    this._adapter = new EVMAdapter(
      evmConfig.network,
      provider,
      evmConfig.signer,
      evmConfig.factoryAddress,
      evmConfig.nftFactoryAddress,
      evmConfig.escrowFactoryAddress,
      evmConfig.multiTokenFactoryAddress,
      evmConfig.rampSettlementFactoryAddress
    );
  }

  // ─── Deploy ──────────────────────────────────────────────────────────────

  /**
   * Deploy a new FarmlandToken via the on-chain factory
   */
  async deployFarmland(opts: DeployFarmlandOptions): Promise<DeployResult> {
    return this._adapter.deployFarmlandToken(opts);
  }

  /**
   * Deploy a new CommodityReceiptToken via the on-chain factory
   */
  async deployCommodity(opts: DeployCommodityOptions): Promise<DeployResult> {
    return this._adapter.deployCommodityReceiptToken(opts);
  }

  /**
   * Deploy a new RealEstateToken via the on-chain factory
   */
  async deployRealEstate(opts: DeployRealEstateOptions): Promise<DeployResult> {
    return this._adapter.deployRealEstateToken(opts);
  }

  /**
   * Deploy a new InvoiceToken via the on-chain factory
   */
  async deployInvoice(opts: DeployInvoiceOptions): Promise<DeployResult> {
    return this._adapter.deployInvoiceToken(opts);
  }

  /**
   * Deploy a new CarbonCreditToken via the on-chain factory
   */
  async deployCarbonCredit(opts: DeployCarbonCreditOptions): Promise<DeployResult> {
    return this._adapter.deployCarbonCreditToken(opts);
  }

  /**
   * Deploy a new MiningRightsToken via the on-chain factory
   */
  async deployMiningRights(opts: DeployMiningRightsOptions): Promise<DeployResult> {
    return this._adapter.deployMiningRightsToken(opts);
  }

  // ─── NFT Deploy ──────────────────────────────────────────────────────────

  async deployFarmlandNFT(opts: DeployFarmlandNFTOptions): Promise<NFTDeployResult> {
    return this._adapter.deployFarmlandNFT(opts);
  }

  async deployRealEstateNFT(opts: DeployRealEstateNFTOptions): Promise<NFTDeployResult> {
    return this._adapter.deployRealEstateNFT(opts);
  }

  async deployMiningRightsNFT(opts: DeployMiningRightsNFTOptions): Promise<NFTDeployResult> {
    return this._adapter.deployMiningRightsNFT(opts);
  }

  async deployCommodityVaultNFT(opts: DeployCommodityVaultNFTOptions): Promise<NFTDeployResult> {
    return this._adapter.deployCommodityVaultNFT(opts);
  }

  async getDeployedNFTs(address?: string): Promise<string[]> {
    return this._adapter.getDeployerNFTs(address);
  }

  async totalDeployedNFTs(): Promise<number> {
    return this._adapter.totalDeployedNFTs();
  }

  // ─── Escrow Deploy ───────────────────────────────────────────────────────

  /**
   * Deploy a new MilestoneEscrow for a payer/payee deal via the on-chain EscrowFactory.
   * `opts.token` must be a stablecoin whitelisted on the EscrowFactory.
   */
  async deployEscrow(opts: DeployEscrowOptions): Promise<EscrowDeployResult> {
    return this._adapter.deployEscrow(opts);
  }

  async getDeployedEscrows(address?: string): Promise<string[]> {
    return this._adapter.getDeployerEscrows(address);
  }

  async totalDeployedEscrows(): Promise<number> {
    return this._adapter.totalDeployedEscrows();
  }

  // ─── Multi-Token (ERC-1155) Deploy ──────────────────────────────────────

  /**
   * Deploy a new CommodityBatchToken (ERC-1155 warehouse receipt) via the on-chain MultiTokenFactory.
   */
  async deployCommodityBatchToken(opts: DeployCommodityBatchOptions): Promise<MultiTokenDeployResult> {
    return this._adapter.deployCommodityBatchToken(opts);
  }

  /**
   * Deploy a new PoolVault (multi-asset ERC-20 fund) via the on-chain MultiTokenFactory.
   */
  async deployPoolVault(opts: DeployPoolVaultOptions): Promise<MultiTokenDeployResult> {
    return this._adapter.deployPoolVault(opts);
  }

  async getDeployedMultiTokens(address?: string): Promise<string[]> {
    return this._adapter.getDeployerMultiTokens(address);
  }

  async totalDeployedMultiTokens(): Promise<number> {
    return this._adapter.totalDeployedMultiTokens();
  }

  // ─── Ramp Settlement Deploy ──────────────────────────────────────────────

  /**
   * Deploy a new RampSettlement contract via the on-chain RampSettlementFactory.
   * Optional on-chain half of a fiat on/off-ramp flow — see RampManager for
   * the off-chain provider orchestration side.
   */
  async deployRampSettlement(opts: DeployRampSettlementOptions): Promise<RampSettlementDeployResult> {
    return this._adapter.deployRampSettlement(opts);
  }

  async getDeployedRampSettlements(address?: string): Promise<string[]> {
    return this._adapter.getDeployerRampSettlements(address);
  }

  async totalDeployedRampSettlements(): Promise<number> {
    return this._adapter.totalDeployedRampSettlements();
  }

  // ─── Queries ─────────────────────────────────────────────────────────────

  /**
   * Get all token addresses deployed by a given wallet
   */
  async getDeployedTokens(address?: string): Promise<string[]> {
    return this._adapter.getDeployerTokens(address);
  }

  /**
   * Total number of tokens deployed via this factory
   */
  async totalDeployed(): Promise<number> {
    return this._adapter.totalDeployed();
  }

  /**
   * Native token balance of a wallet (MATIC / ETH / BNB etc.)
   */
  async getBalance(address?: string): Promise<string> {
    return this._adapter.getBalance(address);
  }

  // ─── Adapter access (escape hatch for advanced use) ──────────────────────

  get adapter(): IAdapter { return this._adapter; }
  get network(): SupportedNetwork { return this._adapter.network; }
}
