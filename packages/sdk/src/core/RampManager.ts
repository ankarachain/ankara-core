import type { IAdapter } from "../adapters/IAdapter";
import type {
  RampProvider,
  RampQuoteInput,
  RampQuote,
  InitiateOnRampInput,
  InitiateOffRampInput,
  RampSession,
  OffRampDeposit,
  OnRampRecord,
  StellarExternalSigner,
} from "../types";
import { RampSessionStatus } from "../types";
import { StellarAnchorProvider } from "../providers/StellarAnchorProvider";

export interface RampManagerOptions {
  /** Address of a deployed RampSettlement contract — enables the on-chain methods below. */
  settlementAddress?: string;
}

/**
 * RampManager
 *
 * Orchestrates fiat on-ramp / off-ramp flows. Always talks to a RampProvider
 * for quotes, session creation, and status (the off-chain half — KYC and the
 * actual fiat movement). Optionally also talks to a deployed RampSettlement
 * contract for an on-chain paper trail — off-ramp deposits are held in real
 * custody there; on-ramp settlements are just an attestation, since minting
 * is performed by the platform's own token contracts, not this one.
 *
 * Pass no `settlementAddress` to use only the off-chain provider methods.
 * The settlement contract can be deployed on either chain — pass an
 * `EVMAdapter` or a `StellarAdapter`, both implement `IAdapter`.
 *
 * @example
 * ```typescript
 * import { RampManager, ManualRampProvider } from "@ankarachain/sdk";
 *
 * const ramp = new RampManager(new ManualRampProvider(), adapter, {
 *   settlementAddress: "0xYourRampSettlement",
 * });
 *
 * const quote   = await ramp.getQuote({ direction: "off-ramp", fiatCurrency: "NGN", tokenSymbol: "mUSD", countryCode: "NG", tokenAmount: "100" });
 * const session = await ramp.initiateOffRamp({ tokenAmount: "100", tokenSymbol: "mUSD", fiatCurrency: "NGN", countryCode: "NG", payoutAccount: { type: "bank", accountNumber: "0123456789", bankCode: "058" } });
 *
 * // caller approves the settlement contract to spend `tokenAmount`, then:
 * await ramp.depositOffRamp(session.sessionId, tokenAddress, ethers.parseEther("100"));
 *
 * // once the provider confirms the fiat payout succeeded:
 * await ramp.confirmOffRampSettlement(session.sessionId);
 * ```
 */
export class RampManager {
  private _provider: RampProvider;
  private _adapter?: IAdapter;
  private _settlementAddress?: string;

  constructor(provider: RampProvider, adapter?: IAdapter, opts: RampManagerOptions = {}) {
    this._provider = provider;
    this._adapter = adapter;
    this._settlementAddress = opts.settlementAddress;
  }

  /**
   * Builds a RampManager backed by a real Stellar anchor's SEP-24 flow
   * instead of a manually-configured `RampProvider` — swap `new
   * RampManager(new ManualRampProvider(), ...)` for `await
   * RampManager.connectAnchor("cowrie.exchange", signer, adapter, opts)` to
   * make any Stellar anchor (Cowrie, MoneyGram, etc.) usable through the
   * same interface. Additive: doesn't touch the constructor above, since
   * `RampManager`'s provider is fixed at construction and has no swap
   * method — this is just a convenience that constructs a
   * `StellarAnchorProvider` for you. The anchor's stellar.toml/SEP-10
   * handshake is resolved lazily, on first real call — not here — so this
   * doesn't do a slow or failing network call disguised as a constructor.
   */
  static connectAnchor(
    anchorHomeDomain: string,
    signer: StellarExternalSigner,
    adapter?: IAdapter,
    opts: RampManagerOptions = {}
  ): RampManager {
    const provider = new StellarAnchorProvider({ homeDomain: anchorHomeDomain, signer });
    return new RampManager(provider, adapter, opts);
  }

  get providerName(): string { return this._provider.name; }
  get hasSettlementContract(): boolean { return !!this._settlementAddress; }
  get settlementAddress(): string | undefined { return this._settlementAddress; }

  // ─── Off-chain (provider) ─────────────────────────────────────────────────

  async getQuote(input: RampQuoteInput): Promise<RampQuote> {
    return this._provider.getQuote(input);
  }

  /** Start an on-ramp session with the provider. Does not touch the chain. */
  async initiateOnRamp(input: InitiateOnRampInput): Promise<RampSession> {
    return this._provider.initiateOnRamp(input);
  }

  /** Start an off-ramp session with the provider. Does not touch the chain. */
  async initiateOffRamp(input: InitiateOffRampInput): Promise<RampSession> {
    return this._provider.initiateOffRamp(input);
  }

  async getStatus(sessionId: string): Promise<RampSessionStatus> {
    return this._provider.getStatus(sessionId);
  }

  // ─── On-chain (optional settlement contract) ─────────────────────────────

  /**
   * Deposit tokens into the settlement contract for an off-ramp session.
   * On EVM the caller must have approved the settlement contract to spend
   * `amount` of `tokenAddress` beforehand; on Stellar the nested transfer is
   * authorized within the same call. Requires a settlementAddress to be
   * configured.
   */
  async depositOffRamp(sessionId: string, tokenAddress: string, amount: bigint): Promise<string> {
    return this._adapterOrThrow().rampDepositOffRamp(
      this._settlementAddressOrThrow(), sessionId, tokenAddress, amount
    );
  }

  /** Release custodied off-ramp tokens to the treasury once the provider confirms the fiat payout. */
  async confirmOffRampSettlement(sessionId: string): Promise<string> {
    return this._adapterOrThrow().rampConfirmOffRampSettlement(
      this._settlementAddressOrThrow(), sessionId
    );
  }

  /** Return custodied off-ramp tokens to the depositor if the fiat payout failed. */
  async refundOffRamp(sessionId: string): Promise<string> {
    return this._adapterOrThrow().rampRefundOffRamp(this._settlementAddressOrThrow(), sessionId);
  }

  /**
   * Record an on-chain attestation that an on-ramp mint/transfer happened for
   * this session. Does not move funds — mint the tokens separately via your
   * existing TokenFactory/adapter calls, then record the attestation here.
   */
  async recordOnRampSettlement(
    sessionId: string,
    recipient: string,
    tokenAddress: string,
    amount: bigint
  ): Promise<string> {
    return this._adapterOrThrow().rampRecordOnRampSettlement(
      this._settlementAddressOrThrow(), sessionId, recipient, tokenAddress, amount
    );
  }

  async getOffRampDeposit(sessionId: string): Promise<OffRampDeposit> {
    return this._adapterOrThrow().rampGetOffRampDeposit(this._settlementAddressOrThrow(), sessionId);
  }

  async getOnRampRecord(sessionId: string): Promise<OnRampRecord> {
    return this._adapterOrThrow().rampGetOnRampRecord(this._settlementAddressOrThrow(), sessionId);
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private _adapterOrThrow(): IAdapter {
    if (!this._adapter || !this._settlementAddress) {
      throw new Error(
        "RampManager has no settlement contract configured. Pass an adapter and settlementAddress to enable on-chain settlement."
      );
    }
    return this._adapter;
  }

  private _settlementAddressOrThrow(): string {
    if (!this._settlementAddress) {
      throw new Error(
        "RampManager has no settlement contract configured. Pass an adapter and settlementAddress to enable on-chain settlement."
      );
    }
    return this._settlementAddress;
  }
}
