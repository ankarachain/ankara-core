import type { StellarAdapter } from "../adapters/stellar";
import type {
  CreateLinearStreamInput, CreateScheduleInput, PaymentStreamInfo, StreamSchedule,
} from "../types/payments";
import { enumTag, enumValues, toBigInt, toNumber } from "../utils/soroban";

interface RawStream {
  id: bigint;
  sender: string;
  recipient: string;
  token: string;
  total_amount: bigint;
  withdrawn: bigint;
  schedule: unknown;
  cancelable: boolean;
  cancelled_at: bigint;
  refunded: bigint;
  created_at: bigint;
}

/**
 * PaymentStream
 *
 * Drives a deployed `payment-stream` Soroban contract: lock a token balance
 * for a recipient and release it continuously per second (salary-style,
 * optional cliff) or in discrete tranches (installments / vesting). The
 * recipient can check `claimable()` and `withdraw()` at any time.
 *
 * Stellar-only — pass a `StellarAdapter`. The signer is the sender for
 * `create*`/`cancel`, and the recipient for `withdraw`.
 *
 * @example
 * ```typescript
 * const streams = new PaymentStream(adapter, "CSTREAM...");
 * const now = BigInt(Math.floor(Date.now() / 1000));
 * const { streamId } = await streams.createLinear({
 *   recipient: "GWORKER...", token: usdcSac, totalAmount: 3_000_0000000n,
 *   start: now, end: now + 30n * 86400n, cancelable: true,
 * });
 * await streams.claimable(streamId);
 * ```
 */
export class PaymentStream {
  static readonly MAX_TRANCHES = 48;

  constructor(private readonly _adapter: StellarAdapter, private readonly _address: string) {}

  get address(): string { return this._address; }

  async createLinear(input: CreateLinearStreamInput): Promise<{ streamId: number; txHash: string }> {
    const sender = await this._adapter.getSignerAddress();
    const cliff = input.cliff ?? input.start;
    if (input.start >= input.end || cliff < input.start || cliff > input.end) {
      throw new Error("Invalid schedule: require start < end and start <= cliff <= end");
    }
    const { result, txHash } = await this._adapter.invokeContract<bigint>(this._address, "create_stream", {
      sender,
      recipient: input.recipient,
      token: input.token,
      total_amount: input.totalAmount,
      start: input.start,
      cliff,
      end: input.end,
      cancelable: input.cancelable ?? false,
    });
    return { streamId: toNumber(result), txHash };
  }

  async createSchedule(input: CreateScheduleInput): Promise<{ streamId: number; txHash: string }> {
    if (input.tranches.length === 0 || input.tranches.length > PaymentStream.MAX_TRANCHES) {
      throw new Error(`A schedule needs 1-${PaymentStream.MAX_TRANCHES} tranches`);
    }
    const sender = await this._adapter.getSignerAddress();
    const { result, txHash } = await this._adapter.invokeContract<bigint>(this._address, "create_schedule", {
      sender,
      recipient: input.recipient,
      token: input.token,
      tranches: input.tranches.map((t) => ({ unlock_time: t.unlockTime, amount: t.amount })),
      cancelable: input.cancelable ?? false,
    });
    return { streamId: toNumber(result), txHash };
  }

  /** Withdraws `amount`, or everything claimable when omitted. Signer must be the recipient. */
  async withdraw(streamId: number, amount?: bigint): Promise<{ amount: bigint; txHash: string }> {
    const recipient = await this._adapter.getSignerAddress();
    const { result, txHash } = await this._adapter.invokeContract<bigint>(this._address, "withdraw", {
      recipient, stream_id: BigInt(streamId), amount: amount ?? undefined,
    });
    return { amount: toBigInt(result), txHash };
  }

  /** Cancels a cancelable stream. Signer must be the sender. */
  async cancel(streamId: number): Promise<{ paidToRecipient: bigint; refundedToSender: bigint; txHash: string }> {
    const sender = await this._adapter.getSignerAddress();
    const { result, txHash } = await this._adapter.invokeContract<[bigint, bigint]>(this._address, "cancel", {
      sender, stream_id: BigInt(streamId),
    });
    const [paid, refunded] = result;
    return { paidToRecipient: toBigInt(paid), refundedToSender: toBigInt(refunded), txHash };
  }

  async getStream(streamId: number): Promise<PaymentStreamInfo> {
    return decodeStream(await this._adapter.readContract<RawStream>(this._address, "get_stream", { stream_id: BigInt(streamId) }));
  }

  async claimable(streamId: number): Promise<bigint> {
    return toBigInt(await this._adapter.readContract(this._address, "claimable", { stream_id: BigInt(streamId) }));
  }

  async vested(streamId: number): Promise<bigint> {
    return toBigInt(await this._adapter.readContract(this._address, "vested", { stream_id: BigInt(streamId) }));
  }

  /** Defaults to the signer's own streams. */
  async streamsBySender(sender?: string): Promise<number[]> {
    const addr = sender ?? await this._adapter.getSignerAddress();
    return (await this._adapter.readContract<bigint[]>(this._address, "streams_by_sender", { sender: addr })).map(toNumber);
  }

  async streamsByRecipient(recipient?: string): Promise<number[]> {
    const addr = recipient ?? await this._adapter.getSignerAddress();
    return (await this._adapter.readContract<bigint[]>(this._address, "streams_by_recipient", { recipient: addr })).map(toNumber);
  }

  async streamCount(): Promise<number> {
    return toNumber(await this._adapter.readContract(this._address, "stream_count", {}));
  }
}

function decodeSchedule(raw: unknown): StreamSchedule {
  const values = enumValues(raw);
  if (enumTag(raw) === "Linear") {
    const [start, cliff, end] = values;
    return { kind: "linear", start: toBigInt(start), cliff: toBigInt(cliff), end: toBigInt(end) };
  }
  const tranches = (values[0] ?? []) as Array<{ unlock_time: bigint; amount: bigint }>;
  return { kind: "tranches", tranches: tranches.map((t) => ({ unlockTime: toBigInt(t.unlock_time), amount: toBigInt(t.amount) })) };
}

function decodeStream(raw: RawStream): PaymentStreamInfo {
  return {
    id: toNumber(raw.id),
    sender: raw.sender,
    recipient: raw.recipient,
    token: raw.token,
    totalAmount: toBigInt(raw.total_amount),
    withdrawn: toBigInt(raw.withdrawn),
    schedule: decodeSchedule(raw.schedule),
    cancelable: raw.cancelable,
    cancelledAt: toBigInt(raw.cancelled_at),
    refunded: toBigInt(raw.refunded),
    createdAt: toBigInt(raw.created_at),
  };
}
