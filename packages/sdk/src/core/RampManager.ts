import { ethers, type ContractTransactionResponse } from "ethers";
import { EVMAdapter } from "../adapters/evm";
import type {
  RampProvider,
  RampQuoteInput,
  RampQuote,
  InitiateOnRampInput,
  InitiateOffRampInput,
  RampSession,
  OffRampDeposit,
  OnRampRecord,
} from "../types";
import { RampSessionStatus, RampSettlementStatus } from "../types";

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
  private _adapter?: EVMAdapter;
  private _settlementAddress?: string;

  constructor(provider: RampProvider, adapter?: EVMAdapter, opts: RampManagerOptions = {}) {
    this._provider = provider;
    this._adapter = adapter;
    this._settlementAddress = opts.settlementAddress;
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
   * Caller must have approved the settlement contract to spend `amount` of
   * `tokenAddress` beforehand. Requires a settlementAddress to be configured.
   */
  async depositOffRamp(sessionId: string, tokenAddress: string, amount: bigint): Promise<string> {
    const contract = this._settlementContract();
    return this._sendAndWait(
      contract.initiateOffRamp(this._refId(sessionId), tokenAddress, amount, sessionId)
    );
  }

  /** Release custodied off-ramp tokens to the treasury once the provider confirms the fiat payout. */
  async confirmOffRampSettlement(sessionId: string): Promise<string> {
    const contract = this._settlementContract();
    return this._sendAndWait(contract.confirmOffRampSettlement(this._refId(sessionId)));
  }

  /** Return custodied off-ramp tokens to the depositor if the fiat payout failed. */
  async refundOffRamp(sessionId: string): Promise<string> {
    const contract = this._settlementContract();
    return this._sendAndWait(contract.refundOffRamp(this._refId(sessionId)));
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
    const contract = this._settlementContract();
    return this._sendAndWait(
      contract.recordOnRampSettlement(this._refId(sessionId), recipient, tokenAddress, amount, sessionId)
    );
  }

  async getOffRampDeposit(sessionId: string): Promise<OffRampDeposit> {
    const contract = this._settlementContract();
    const d = await contract.getOffRamp(this._refId(sessionId));
    return {
      depositor:   d.depositor,
      token:       d.token,
      amount:      d.amount,
      status:      Number(d.status) as RampSettlementStatus,
      initiatedAt: d.initiatedAt,
    };
  }

  async getOnRampRecord(sessionId: string): Promise<OnRampRecord> {
    const contract = this._settlementContract();
    const r = await contract.getOnRamp(this._refId(sessionId));
    return {
      recipient:  r.recipient,
      token:      r.token,
      amount:     r.amount,
      status:     Number(r.status) as RampSettlementStatus,
      recordedAt: r.recordedAt,
    };
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _settlementContract(): any {
    if (!this._adapter || !this._settlementAddress) {
      throw new Error(
        "RampManager has no settlement contract configured. Pass an EVMAdapter and settlementAddress to enable on-chain settlement."
      );
    }
    return this._adapter.rampSettlement(this._settlementAddress);
  }

  private _refId(sessionId: string): string {
    return ethers.keccak256(ethers.toUtf8Bytes(sessionId));
  }

  private async _sendAndWait(txPromise: Promise<ContractTransactionResponse>): Promise<string> {
    const tx = await txPromise;
    const receipt = await tx.wait();
    if (!receipt) throw new Error("Transaction receipt unavailable");
    return receipt.hash;
  }
}
