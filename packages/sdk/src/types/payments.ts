/** One installment of a step-vesting schedule. */
export interface StreamTranche {
  /** unix seconds */
  unlockTime: bigint;
  amount: bigint;
}

export type StreamSchedule =
  | { kind: "linear"; start: bigint; cliff: bigint; end: bigint }
  | { kind: "tranches"; tranches: StreamTranche[] };

/** On-chain `Stream` from `payment-stream`. */
export interface PaymentStreamInfo {
  id: number;
  sender: string;
  recipient: string;
  token: string;
  totalAmount: bigint;
  withdrawn: bigint;
  schedule: StreamSchedule;
  cancelable: boolean;
  /** `0n` unless cancelled. */
  cancelledAt: bigint;
  refunded: bigint;
  createdAt: bigint;
}

export interface CreateLinearStreamInput {
  recipient: string;
  token: string;
  totalAmount: bigint;
  /** unix seconds */
  start: bigint;
  end: bigint;
  /** Defaults to `start` (no cliff). */
  cliff?: bigint;
  cancelable?: boolean;
}

export interface CreateScheduleInput {
  recipient: string;
  token: string;
  tranches: StreamTranche[];
  cancelable?: boolean;
}

export interface Disbursement {
  recipient: string;
  amount: bigint;
}

export interface DisburseResult {
  /** One tx per chunk of at most `BatchDisburser.MAX_PAYMENTS` payments, in order. */
  txHashes: string[];
  totalPaid: bigint;
  batches: number;
}
