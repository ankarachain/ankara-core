import { describe, it, expect, vi } from "vitest";
import { PoolGovernance, encodeAction } from "./PoolGovernance";
import type { StellarAdapter } from "../adapters/stellar";

const VAULT = "CVAULT";

function mockAdapter(results: Record<string, unknown> = {}) {
  const invokeContract = vi.fn(async (_id: string, method: string, _args?: Record<string, unknown>) => ({ result: results[method], txHash: `tx-${method}` }));
  const readContract = vi.fn(async (_id: string, method: string, _args?: Record<string, unknown>) => results[method]);
  const adapter = { invokeContract, readContract, getSignerAddress: vi.fn(async () => "GSIGNER") } as unknown as StellarAdapter;
  return { adapter, invokeContract, readContract };
}

describe("PoolGovernance", () => {
  it("encodes every action kind", () => {
    expect(encodeAction({ kind: "set-management-fee-bps", feeBps: 25 })).toEqual({ tag: "SetManagementFeeBps", values: [25] });
    expect(encodeAction({ kind: "add-accepted-token", token: "CT", weightBps: 100 })).toEqual({ tag: "AddAcceptedToken", values: ["CT", 100] });
    expect(encodeAction({ kind: "set-min-deposit", token: "CT", minAmount: 5n })).toEqual({ tag: "SetMinDeposit", values: ["CT", 5n] });
    const up = encodeAction({ kind: "upgrade", wasmHash: "0x" + "ab".repeat(32) });
    expect(up.tag).toBe("Upgrade");
    expect(Buffer.from(up.values![0] as Buffer).toString("hex")).toBe("ab".repeat(32));
  });

  it("proposes, votes, executes as the signer", async () => {
    const { adapter, invokeContract } = mockAdapter({ propose: 4n });
    const gov = new PoolGovernance(adapter, VAULT);
    expect((await gov.propose({ kind: "set-oracle", oracle: "CORACLE" })).proposalId).toBe(4);
    expect(invokeContract).toHaveBeenCalledWith(VAULT, "propose", { proposer: "GSIGNER", action: { tag: "SetOracle", values: ["CORACLE"] } });
    await gov.vote(4, false);
    expect(invokeContract).toHaveBeenCalledWith(VAULT, "vote", { voter: "GSIGNER", proposal_id: 4n, support: false });
    await gov.execute(4);
    await gov.cancel(4);
    expect(invokeContract).toHaveBeenCalledWith(VAULT, "cancel_proposal", { proposer: "GSIGNER", proposal_id: 4n });
  });

  it("enables governance with snake_case config and reads it back", async () => {
    const { adapter, invokeContract } = mockAdapter({
      governance_config: { voting_period: 10n, timelock: 5n, quorum_bps: 2000, proposal_threshold_bps: 100 },
    });
    const gov = new PoolGovernance(adapter, VAULT);
    const cfg = { votingPeriod: 10n, timelock: 5n, quorumBps: 2000, proposalThresholdBps: 100 };
    await gov.enableGovernance(cfg);
    expect(invokeContract).toHaveBeenCalledWith(VAULT, "enable_governance", {
      governance_config: { voting_period: 10n, timelock: 5n, quorum_bps: 2000, proposal_threshold_bps: 100 },
    });
    expect(await gov.getConfig()).toEqual(cfg);
    expect(await new PoolGovernance(mockAdapter({ governance_config: undefined }).adapter, VAULT).getConfig()).toBeNull();
  });

  it("decodes proposals and state", async () => {
    const { adapter } = mockAdapter({
      get_proposal: {
        id: 1n, proposer: "GP", action: { tag: "SetManagementFeeBps", values: [25] }, created_at: 1n, voting_ends: 2n, eta: 3n,
        for_votes: 600n, against_votes: 300n, quorum_votes: 200n, executed: false, cancelled: false,
      },
      proposal_state: { tag: "Queued" },
      locked_balance: 300n,
    });
    const gov = new PoolGovernance(adapter, VAULT);
    const p = await gov.getProposal(1);
    expect(p.action).toEqual({ kind: "set-management-fee-bps", feeBps: 25 });
    expect(p.forVotes).toBe(600n);
    expect(await gov.getState(1)).toBe("queued");
    expect(await gov.lockedBalance()).toBe(300n);
  });
});
