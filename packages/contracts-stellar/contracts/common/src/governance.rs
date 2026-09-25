use soroban_sdk::contracttype;

/// Parameters for token-weighted governance of a contract's manager-gated
/// actions (used by `pool-vault`'s opt-in governance mode, and by
/// `multi-token-factory::deploy_governed_pool_vault`). Shared here so the
/// factory and the vault agree on one type without the factory depending
/// on the vault crate.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GovernanceConfig {
    /// How long a proposal is open for voting, in seconds.
    pub voting_period: u64,
    /// Delay between a proposal passing and it becoming executable, in
    /// seconds — the window in which holders who disagree can exit.
    pub timelock: u64,
    /// Minimum participation (for + against), in bps of total supply.
    pub quorum_bps: u32,
    /// Minimum share of total supply a proposer must hold, in bps.
    pub proposal_threshold_bps: u32,
}

impl GovernanceConfig {
    pub fn is_valid(&self) -> bool {
        self.voting_period > 0
            && self.quorum_bps > 0
            && self.quorum_bps <= 10_000
            && self.proposal_threshold_bps <= 10_000
    }
}
