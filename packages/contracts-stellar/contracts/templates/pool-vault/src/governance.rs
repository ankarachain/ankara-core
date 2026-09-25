use ankara_common::governance::GovernanceConfig;
use soroban_sdk::{contracttype, panic_with_error, Address, BytesN, Env};

use crate::contract::PoolVaultError;

const DAY_IN_LEDGERS: u32 = 17280;
const BUMP_AMOUNT: u32 = 180 * DAY_IN_LEDGERS;
const LIFETIME_THRESHOLD: u32 = BUMP_AMOUNT - DAY_IN_LEDGERS;

/// A manager-gated vault action that, in governance mode, only a passed
/// proposal can perform.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Action {
    SetManagementFeeBps(u32),
    SetOracle(Address),
    AddAcceptedToken(Address, u32),
    RemoveAcceptedToken(Address),
    SetMinDeposit(Address, i128),
    Upgrade(BytesN<32>),
}

#[contracttype]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum ProposalState {
    /// Voting open.
    Active,
    /// Voting closed; did not pass (quorum or majority not met).
    Defeated,
    /// Passed; waiting out the timelock.
    Queued,
    /// Passed and past the timelock — anyone may execute.
    Executable,
    Executed,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Proposal {
    pub id: u64,
    pub proposer: Address,
    pub action: Action,
    pub created_at: u64,
    pub voting_ends: u64,
    /// Executable from this timestamp if passed.
    pub eta: u64,
    pub for_votes: i128,
    pub against_votes: i128,
    /// Participation needed to pass — fixed from total supply at creation,
    /// so deposits during voting can't move the goalposts.
    pub quorum_votes: i128,
    pub executed: bool,
    pub cancelled: bool,
}

/// Tokens a voter has committed to open votes, frozen until `until`.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VoteLock {
    pub amount: i128,
    pub until: u64,
}

#[contracttype]
enum GovKey {
    Config,
    NextId,
    Proposal(u64),
    Voted(u64, Address),
    Lock(Address),
}

pub fn config(env: &Env) -> Option<GovernanceConfig> {
    env.storage().instance().get(&GovKey::Config)
}

pub fn is_enabled(env: &Env) -> bool {
    env.storage().instance().has(&GovKey::Config)
}

pub fn enable(env: &Env, cfg: &GovernanceConfig) {
    if is_enabled(env) {
        panic_with_error!(env, PoolVaultError::GovernanceEnabled);
    }
    if !cfg.is_valid() {
        panic_with_error!(env, PoolVaultError::InvalidGovernanceConfig);
    }
    env.storage().instance().set(&GovKey::Config, cfg);
}

pub fn next_id(env: &Env) -> u64 {
    let id: u64 = env.storage().instance().get(&GovKey::NextId).unwrap_or(0);
    env.storage().instance().set(&GovKey::NextId, &(id + 1));
    id
}

pub fn count(env: &Env) -> u64 {
    env.storage().instance().get(&GovKey::NextId).unwrap_or(0)
}

pub fn get(env: &Env, id: u64) -> Proposal {
    env.storage()
        .persistent()
        .get(&GovKey::Proposal(id))
        .unwrap_or_else(|| panic_with_error!(env, PoolVaultError::ProposalNotFound))
}

pub fn set(env: &Env, p: &Proposal) {
    let key = GovKey::Proposal(p.id);
    env.storage().persistent().set(&key, p);
    env.storage()
        .persistent()
        .extend_ttl(&key, LIFETIME_THRESHOLD, BUMP_AMOUNT);
}

pub fn has_voted(env: &Env, id: u64, voter: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&GovKey::Voted(id, voter.clone()))
}

pub fn mark_voted(env: &Env, id: u64, voter: &Address, support: bool) {
    let key = GovKey::Voted(id, voter.clone());
    env.storage().persistent().set(&key, &support);
    env.storage()
        .persistent()
        .extend_ttl(&key, LIFETIME_THRESHOLD, BUMP_AMOUNT);
}

pub fn lock_of(env: &Env, voter: &Address) -> VoteLock {
    env.storage()
        .persistent()
        .get(&GovKey::Lock(voter.clone()))
        .unwrap_or(VoteLock { amount: 0, until: 0 })
}

/// Extends the voter's lock to cover `amount` until `until` (both only ever
/// grow while a lock is live).
pub fn extend_lock(env: &Env, voter: &Address, amount: i128, until: u64) {
    let now = env.ledger().timestamp();
    let current = lock_of(env, voter);
    let live = current.until > now;
    let lock = VoteLock {
        amount: if live { current.amount.max(amount) } else { amount },
        until: if live { current.until.max(until) } else { until },
    };
    let key = GovKey::Lock(voter.clone());
    env.storage().persistent().set(&key, &lock);
    env.storage()
        .persistent()
        .extend_ttl(&key, LIFETIME_THRESHOLD, BUMP_AMOUNT);
}

/// Amount currently frozen for `holder` (0 once the lock has expired).
pub fn locked_amount(env: &Env, holder: &Address) -> i128 {
    let lock = lock_of(env, holder);
    if lock.until > env.ledger().timestamp() {
        lock.amount
    } else {
        0
    }
}

/// Reverts if moving `amount` out of `holder`'s balance would dip into
/// tokens locked by an open vote — this is what stops the same shares from
/// voting twice via a transfer.
pub fn check_unlocked(env: &Env, holder: &Address, amount: i128) {
    let locked = locked_amount(env, holder);
    if locked > 0 && ankara_common::fungible::balance(env, holder) - amount < locked {
        panic_with_error!(env, PoolVaultError::TokensLocked);
    }
}

pub fn state(env: &Env, p: &Proposal) -> ProposalState {
    if p.cancelled {
        return ProposalState::Cancelled;
    }
    if p.executed {
        return ProposalState::Executed;
    }
    let now = env.ledger().timestamp();
    if now <= p.voting_ends {
        return ProposalState::Active;
    }
    let passed = p.for_votes > p.against_votes && p.for_votes + p.against_votes >= p.quorum_votes;
    if !passed {
        ProposalState::Defeated
    } else if now < p.eta {
        ProposalState::Queued
    } else {
        ProposalState::Executable
    }
}
