import type { StellarAdapter } from "../adapters/stellar";
import type { Disbursement, DisburseResult } from "../types/payments";
import { toBigInt } from "../utils/soroban";

/**
 * BatchDisburser
 *
 * Drives a deployed `batch-disburser` Soroban contract: one signer pays many
 * recipients per transaction (payroll, cooperative distributions, relief
 * payouts). Lists longer than the contract's 100-per-call limit are split
 * into consecutive transactions automatically. Each on-chain batch is
 * atomic — a failing recipient reverts that whole batch.
 *
 * Stellar-only — pass a `StellarAdapter`; the signer is the payer.
 *
 * @example
 * ```typescript
 * const disburser = new BatchDisburser(adapter, "CDISBURSER...");
 * const { txHashes, totalPaid } = await disburser.disburse(usdcSac, [
 *   { recipient: "GA...", amount: 150_0000000n },
 *   { recipient: "GB...", amount: 220_0000000n },
 * ], "payroll-2026-09");
 * ```
 */
export class BatchDisburser {
  static readonly MAX_PAYMENTS = 100;

  constructor(private readonly _adapter: StellarAdapter, private readonly _address: string) {}

  get address(): string { return this._address; }

  async disburse(token: string, payments: Disbursement[], reference = ""): Promise<DisburseResult> {
    validate(payments);
    const payer = await this._adapter.getSignerAddress();
    const txHashes: string[] = [];
    let totalPaid = 0n;
    for (const chunk of chunkPayments(payments)) {
      const { result, txHash } = await this._adapter.invokeContract<bigint>(this._address, "disburse", {
        payer,
        token,
        payments: chunk.map((p) => ({ recipient: p.recipient, amount: p.amount })),
        reference,
      });
      txHashes.push(txHash);
      totalPaid += toBigInt(result);
    }
    return { txHashes, totalPaid, batches: txHashes.length };
  }

  /** Same amount to every recipient. */
  async disburseEqual(token: string, recipients: string[], amountEach: bigint, reference = ""): Promise<DisburseResult> {
    return this.disburse(token, recipients.map((recipient) => ({ recipient, amount: amountEach })), reference);
  }
}

/** Splits a payment list into contract-sized chunks, preserving order. */
export function chunkPayments(payments: Disbursement[], size = BatchDisburser.MAX_PAYMENTS): Disbursement[][] {
  const out: Disbursement[][] = [];
  for (let i = 0; i < payments.length; i += size) out.push(payments.slice(i, i + size));
  return out;
}

function validate(payments: Disbursement[]): void {
  if (payments.length === 0) throw new Error("No payments to disburse");
  payments.forEach((p, i) => {
    if (p.amount <= 0n) throw new Error(`Payment #${i + 1} to ${p.recipient} has a non-positive amount`);
  });
}

/**
 * Parses `recipient,amount` lines (optional header row, `#` comments) into
 * disbursements. Amounts are integers in the token's smallest unit.
 */
export function parseDisbursementCsv(csv: string): Disbursement[] {
  const out: Disbursement[] = [];
  csv.split(/\r?\n/).forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const [recipient, amount] = trimmed.split(",").map((c) => c.trim());
    if (idx === 0 && !/^\d+$/.test(amount ?? "")) return; // header
    if (!recipient || !amount || !/^\d+$/.test(amount)) {
      throw new Error(`Line ${idx + 1}: expected "recipient,amount" with an integer amount, got "${trimmed}"`);
    }
    out.push({ recipient, amount: BigInt(amount) });
  });
  return out;
}
