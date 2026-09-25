import type { StellarAdapter } from "../adapters/stellar";
import type { PoolGovernanceConfig } from "../types";
import { enumTag, enumValues, optional, sorobanEnum, toBigInt, toHex, hexToBytes32, toNumber } from "../utils/soroban";

/** A manager-gated vault change that, in governance mode, needs a passed proposal. */
export type PoolAction =
  | { kind: "set-management-fee-bps"; feeBps: number }
  | { kind: "set-oracle"; oracle: string }
  | { kind: "add-accepted-token"; token: string; weightBps: number }
  | { kind: "remove-accepted-token"; token: string }
  | { kind: "set-min-deposit"; token: string; minAmount: bigint }
  /** 32-byte wasm hash, `0x` hex. */
  | { kind: "upgrade"; wasmHash: string };

export type ProposalState = "active" | "defeated" | "queued" | "executable" | "executed" | "cancelled";

export interface PoolProposal {
  id: number;
  proposer: string;
  action: PoolAction;
  createdAt: bigint;
  votingEnds: bigint;
  /** Executable from this timestamp if passed. */
  eta: bigint;
  forVotes: bigint;
  againstVotes: bigint;
  quorumVotes: bigint;
  executed: boolean;
  cancelled: boolean;
}

/**
 * PoolGovernance
 *
 * Token-weighted governance for a Stellar `pool-vault` in governance mode.
 * Pool-share holders propose manager-gated changes (fee, oracle, accepted
 * tokens, min deposit, upgrade), vote weighted by their share balance, and —
 * after the timelock — anyone executes a passed proposal. Voting locks the
 * voter's shares until voting ends, so the same shares can't vote twice.
 *
 * Opt in at deployment with `TokenFactory.deployPoolVault({ ..., governance })`,
 * or later (one-way) with `enableGovernance`. Vaults that never opt in keep
 * the single-Manager model.
 *
 * @example
 * ```typescript
 * const gov = new PoolGovernance(memberAdapter, vaultAddress);
 * const { proposalId } = await gov.propose({ kind: "set-management-fee-bps", feeBps: 25 });
 * await gov.vote(proposalId, true);
 * // ...after voting period + timelock:
 * if ((await gov.getState(proposalId)) === "executable") await gov.execute(proposalId);
 * ```
 */
export class PoolGovernance {
  constructor(private readonly _adapter: StellarAdapter, private readonly _vaultAddress: string) {}

  get address(): string { return this._vaultAddress; }

  /** Manager, one-way. */
  async enableGovernance(config: PoolGovernanceConfig): Promise<string> {
    return (await this._adapter.invokeContract(this._vaultAddress, "enable_governance", {
      governance_config: encodeConfig(config),
    })).txHash;
  }

  async getConfig(): Promise<PoolGovernanceConfig | null> {
    const raw = optional(await this._adapter.readContract<{
      voting_period: bigint; timelock: bigint; quorum_bps: number; proposal_threshold_bps: number;
    } | null>(this._vaultAddress, "governance_config", {}));
    return raw ? {
      votingPeriod: toBigInt(raw.voting_period),
      timelock: toBigInt(raw.timelock),
      quorumBps: toNumber(raw.quorum_bps),
      proposalThresholdBps: toNumber(raw.proposal_threshold_bps),
    } : null;
  }

  async propose(action: PoolAction): Promise<{ proposalId: number; txHash: string }> {
    const proposer = await this._adapter.getSignerAddress();
    const { result, txHash } = await this._adapter.invokeContract<bigint>(this._vaultAddress, "propose", {
      proposer, action: encodeAction(action),
    });
    return { proposalId: toNumber(result), txHash };
  }

  /** Votes with the signer's full share balance (locked until voting ends). */
  async vote(proposalId: number, support: boolean): Promise<string> {
    const voter = await this._adapter.getSignerAddress();
    return (await this._adapter.invokeContract(this._vaultAddress, "vote", {
      voter, proposal_id: BigInt(proposalId), support,
    })).txHash;
  }

  async cancel(proposalId: number): Promise<string> {
    const proposer = await this._adapter.getSignerAddress();
    return (await this._adapter.invokeContract(this._vaultAddress, "cancel_proposal", {
      proposer, proposal_id: BigInt(proposalId),
    })).txHash;
  }

  /** Anyone, once a passed proposal's timelock has elapsed. */
  async execute(proposalId: number): Promise<string> {
    return (await this._adapter.invokeContract(this._vaultAddress, "execute", { proposal_id: BigInt(proposalId) })).txHash;
  }

  async getProposal(proposalId: number): Promise<PoolProposal> {
    const r = await this._adapter.readContract<Record<string, unknown>>(this._vaultAddress, "get_proposal", {
      proposal_id: BigInt(proposalId),
    });
    return {
      id: toNumber(r.id),
      proposer: String(r.proposer),
      action: decodeAction(r.action),
      createdAt: toBigInt(r.created_at),
      votingEnds: toBigInt(r.voting_ends),
      eta: toBigInt(r.eta),
      forVotes: toBigInt(r.for_votes),
      againstVotes: toBigInt(r.against_votes),
      quorumVotes: toBigInt(r.quorum_votes),
      executed: Boolean(r.executed),
      cancelled: Boolean(r.cancelled),
    };
  }

  async getState(proposalId: number): Promise<ProposalState> {
    return enumTag(await this._adapter.readContract(this._vaultAddress, "proposal_state", {
      proposal_id: BigInt(proposalId),
    })).toLowerCase() as ProposalState;
  }

  async proposalCount(): Promise<number> {
    return toNumber(await this._adapter.readContract(this._vaultAddress, "proposal_count", {}));
  }

  async hasVoted(proposalId: number, voter?: string): Promise<boolean> {
    const addr = voter ?? await this._adapter.getSignerAddress();
    return this._adapter.readContract<boolean>(this._vaultAddress, "has_voted", { proposal_id: BigInt(proposalId), voter: addr });
  }

  /** Shares currently frozen by open votes. Defaults to the signer. */
  async lockedBalance(holder?: string): Promise<bigint> {
    const addr = holder ?? await this._adapter.getSignerAddress();
    return toBigInt(await this._adapter.readContract(this._vaultAddress, "locked_balance", { holder: addr }));
  }
}

function encodeConfig(c: PoolGovernanceConfig) {
  return {
    voting_period: c.votingPeriod,
    timelock: c.timelock,
    quorum_bps: c.quorumBps,
    proposal_threshold_bps: c.proposalThresholdBps,
  };
}

export function encodeAction(a: PoolAction): { tag: string; values?: unknown[] } {
  switch (a.kind) {
    case "set-management-fee-bps": return sorobanEnum("SetManagementFeeBps", a.feeBps);
    case "set-oracle": return sorobanEnum("SetOracle", a.oracle);
    case "add-accepted-token": return sorobanEnum("AddAcceptedToken", a.token, a.weightBps);
    case "remove-accepted-token": return sorobanEnum("RemoveAcceptedToken", a.token);
    case "set-min-deposit": return sorobanEnum("SetMinDeposit", a.token, a.minAmount);
    case "upgrade": return sorobanEnum("Upgrade", hexToBytes32(a.wasmHash));
  }
}

function decodeAction(raw: unknown): PoolAction {
  const v = enumValues(raw);
  switch (enumTag(raw)) {
    case "SetManagementFeeBps": return { kind: "set-management-fee-bps", feeBps: toNumber(v[0]) };
    case "SetOracle": return { kind: "set-oracle", oracle: String(v[0]) };
    case "AddAcceptedToken": return { kind: "add-accepted-token", token: String(v[0]), weightBps: toNumber(v[1]) };
    case "RemoveAcceptedToken": return { kind: "remove-accepted-token", token: String(v[0]) };
    case "SetMinDeposit": return { kind: "set-min-deposit", token: String(v[0]), minAmount: toBigInt(v[1]) };
    default: return { kind: "upgrade", wasmHash: toHex(v[0]) };
  }
}
