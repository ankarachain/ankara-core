import { describe, it, expect, vi } from "vitest";
import { CollateralVault } from "./CollateralVault";
import { SavingsCircle } from "./SavingsCircle";
import { ManualCreditScorer } from "./ManualCreditScorer";
import type { StellarAdapter } from "../adapters/stellar";
import type { IAdapter } from "../adapters/IAdapter";
import { LoanStatus } from "../types";

const ADDR = "CCONTRACT";

function mockAdapter(results: Record<string, unknown> = {}) {
  const invokeContract = vi.fn(async (_id: string, method: string, _args?: Record<string, unknown>) => ({ result: results[method], txHash: `tx-${method}` }));
  const readContract = vi.fn(async (_id: string, method: string, _args?: Record<string, unknown>) => results[method]);
  const adapter = { invokeContract, readContract, getSignerAddress: vi.fn(async () => "GSIGNER") } as unknown as StellarAdapter;
  return { adapter, invokeContract, readContract };
}

describe("CollateralVault score-based lending", () => {
  it("opens unsecured and partially secured scored loans", async () => {
    const { adapter, invokeContract } = mockAdapter({ open_scored_loan: 3n });
    const vault = new CollateralVault(adapter as unknown as IAdapter, ADDR);
    expect(await vault.openScoredLoan({ borrowAmount: 500n, termSecs: 86400n })).toEqual({ loanId: 3, txHash: "tx-open_scored_loan" });
    expect(invokeContract).toHaveBeenCalledWith(ADDR, "open_scored_loan", {
      caller: "GSIGNER", collateral_token: undefined, collateral_amount: 0n, borrow_amount: 500n, term_secs: 86400n,
    });
    await vault.openScoredLoan({ borrowAmount: 800n, termSecs: 1n, collateralToken: "CFARM", collateralAmount: 1000n });
    expect(invokeContract).toHaveBeenLastCalledWith(ADDR, "open_scored_loan", {
      caller: "GSIGNER", collateral_token: "CFARM", collateral_amount: 1000n, borrow_amount: 800n, term_secs: 1n,
    });
  });

  it("encodes score config and rejects unordered tiers", async () => {
    const { adapter, invokeContract } = mockAdapter();
    const vault = new CollateralVault(adapter as unknown as IAdapter, ADDR);
    await vault.setScoreConfig({
      source: "CSCORER",
      tiers: [{ minScore: 500, creditLimit: 200n, feeBps: 500, maxTermSecs: 100n }, { minScore: 700, creditLimit: 1000n, feeBps: 200, maxTermSecs: 200n }],
      maxScoreAge: 86400n,
    });
    expect(invokeContract).toHaveBeenCalledWith(ADDR, "set_score_config", {
      config: {
        source: "CSCORER",
        tiers: [
          { min_score: 500, credit_limit: 200n, fee_bps: 500, max_term_secs: 100n },
          { min_score: 700, credit_limit: 1000n, fee_bps: 200, max_term_secs: 200n },
        ],
        max_score_age: 86400n,
      },
    });
    await expect(vault.setScoreConfig({
      source: "C", tiers: [{ minScore: 700, creditLimit: 1n, feeBps: 0, maxTermSecs: 1n }, { minScore: 600, creditLimit: 1n, feeBps: 0, maxTermSecs: 1n }], maxScoreAge: 1n,
    })).rejects.toThrow(/ascending/);
  });

  it("decodes terms, limits and amount due", async () => {
    const { adapter } = mockAdapter({
      get_scored_terms: { score: 720, unsecured_amount: 1000n, fee_bps: 200, due_at: 99n },
      scored_borrow_limit: 800n,
      amount_due: 1020n,
    });
    const vault = new CollateralVault(adapter as unknown as IAdapter, ADDR);
    expect(await vault.getScoredTerms(1)).toEqual({ score: 720, unsecuredAmount: 1000n, feeBps: 200, dueAt: 99n });
    expect(await vault.scoredBorrowLimit("G")).toBe(800n);
    expect(await vault.amountDue(1)).toBe(1020n);
    expect(await new CollateralVault(mockAdapter({ get_scored_terms: undefined }).adapter as unknown as IAdapter, ADDR).getScoredTerms(1)).toBeNull();
  });

  it("requires a Stellar adapter and exposes the DEFAULTED status", async () => {
    await expect(new CollateralVault({} as IAdapter, ADDR).markDefaulted(1)).rejects.toThrow(/Stellar-only/);
    expect(LoanStatus.DEFAULTED).toBe(3);
  });
});

describe("SavingsCircle", () => {
  it("creates rotating and pooled circles", async () => {
    const { adapter, invokeContract } = mockAdapter({ create_circle: 0n });
    const c = new SavingsCircle(adapter, ADDR);
    await c.createCircle({ token: "CU", mode: "rotating", contribution: 50n, periodSecs: 604800n, maxMembers: 10 });
    expect(invokeContract).toHaveBeenCalledWith(ADDR, "create_circle", {
      organizer: "GSIGNER", token: "CU", mode: { tag: "Rotating" }, contribution: 50n, period_secs: 604800n,
      max_members: 10, rounds: 0, borrow_multiple_bps: 0, loan_fee_bps: 0,
    });
    await expect(c.createCircle({ token: "CU", mode: "pooled", contribution: 1n, periodSecs: 1n, maxMembers: 3 })).rejects.toThrow(/rounds/);
  });

  it("member actions sign as the member", async () => {
    const { adapter, invokeContract } = mockAdapter({ disburse: 300n, repay: 220n, withdraw: 206n });
    const c = new SavingsCircle(adapter, ADDR);
    await c.join(1);
    await c.contribute(1);
    await c.borrow(1, 200n);
    expect(invokeContract).toHaveBeenCalledWith(ADDR, "join", { member: "GSIGNER", circle_id: 1n });
    expect(invokeContract).toHaveBeenCalledWith(ADDR, "borrow", { member: "GSIGNER", circle_id: 1n, amount: 200n });
    expect((await c.disburse(1)).amount).toBe(300n);
    expect((await c.repay(1)).amount).toBe(220n);
    expect((await c.withdraw(1)).amount).toBe(206n);
  });

  it("decodes circles and members", async () => {
    const { adapter } = mockAdapter({
      get_circle: {
        id: 1n, organizer: "GO", token: "CU", mode: { tag: "Pooled" }, contribution: 100n, period_secs: 7n, max_members: 3, rounds: 4,
        members: ["GO", "GA"], status: { tag: "Active" }, started_at: 5n, current_round: 0, pot: 0n, borrow_multiple_bps: 20000,
        loan_fee_bps: 1000, pool_cash: 300n, total_savings: 300n, total_fees: 0n, closed: false, close_pool: 0n, close_weight: 0n,
      },
      get_member: { saved: 100n, missed: 0, paid_out: false, withdrawn: false, last_contributed: 1, loan: { principal: 200n, fee: 20n, taken_at: 6n } },
    });
    const c = new SavingsCircle(adapter, ADDR);
    const info = await c.getCircle(1);
    expect(info.mode).toBe("pooled");
    expect(info.status).toBe("active");
    expect(info.members).toEqual(["GO", "GA"]);
    expect((await c.getMember(1)).loan).toEqual({ principal: 200n, fee: 20n, takenAt: 6n });
  });
});

describe("ManualCreditScorer", () => {
  it("sets and reads scores", async () => {
    const { adapter, invokeContract } = mockAdapter({ credit_score: { score: 700, updated_at: 9n } });
    const s = new ManualCreditScorer(adapter, ADDR);
    await s.setScore("GB", 700);
    expect(invokeContract).toHaveBeenCalledWith(ADDR, "set_score", { borrower: "GB", score: 700 });
    expect(await s.getScore("GB")).toEqual({ score: 700, updatedAt: 9n });
    await expect(s.batchSetScores(Array.from({ length: 51 }, () => ({ borrower: "G", score: 1 })))).rejects.toThrow(/At most 50/);
  });
});
