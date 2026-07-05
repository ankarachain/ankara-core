use soroban_sdk::{contracttype, panic_with_error, Address, BytesN, Env, Vec};

use crate::errors::EscrowError;

/// Direct port of `MilestoneEscrow.sol`'s `MilestoneStatus` enum.
#[contracttype]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum MilestoneStatus {
    Pending,
    Delivered,
    Disputed,
    Released,
    Refunded,
}

/// Direct port of `MilestoneEscrow.sol`'s `Milestone` struct.
#[contracttype]
#[derive(Clone)]
pub struct Milestone {
    pub amount: i128,
    pub description_hash: BytesN<32>,
    pub status: MilestoneStatus,
    pub delivered_at: u64,
    /// Funded independently per milestone rather than once for the whole deal —
    /// lets the payer pay in installments instead of depositing the full total
    /// up front.
    pub funded: bool,
}

const DAY_IN_LEDGERS: u32 = 17280;
const DEAL_BUMP_AMOUNT: u32 = 180 * DAY_IN_LEDGERS;
const DEAL_LIFETIME_THRESHOLD: u32 = DEAL_BUMP_AMOUNT - DAY_IN_LEDGERS;
pub const DEFAULT_TIMELOCK_SECONDS: u64 = 7 * 24 * 60 * 60;

#[contracttype]
enum DataKey {
    Payer,
    Payee,
    Arbiter,
    Token,
    TimelockDuration,
    TotalAmount,
    Cancelled,
    MilestoneCount,
    Milestone(u32),
    CancelVotePayer,
    CancelVotePayee,
}

#[allow(clippy::too_many_arguments)]
pub fn init_deal(
    env: &Env,
    payer: Address,
    payee: Address,
    arbiter: Option<Address>,
    token: Address,
    timelock_duration: u64,
    amounts: Vec<i128>,
    description_hashes: Vec<BytesN<32>>,
) {
    env.storage().instance().set(&DataKey::Payer, &payer);
    env.storage().instance().set(&DataKey::Payee, &payee);
    if let Some(a) = &arbiter {
        env.storage().instance().set(&DataKey::Arbiter, a);
    }
    env.storage().instance().set(&DataKey::Token, &token);
    let timelock = if timelock_duration > 0 {
        timelock_duration
    } else {
        DEFAULT_TIMELOCK_SECONDS
    };
    env.storage()
        .instance()
        .set(&DataKey::TimelockDuration, &timelock);
    env.storage().instance().set(&DataKey::Cancelled, &false);

    let mut total: i128 = 0;
    for i in 0..amounts.len() {
        let amount = amounts.get(i).unwrap();
        let description_hash = description_hashes.get(i).unwrap();
        total += amount;
        let key = DataKey::Milestone(i);
        env.storage().persistent().set(
            &key,
            &Milestone {
                amount,
                description_hash,
                status: MilestoneStatus::Pending,
                delivered_at: 0,
                funded: false,
            },
        );
        env.storage()
            .persistent()
            .extend_ttl(&key, DEAL_LIFETIME_THRESHOLD, DEAL_BUMP_AMOUNT);
    }
    env.storage()
        .instance()
        .set(&DataKey::MilestoneCount, &amounts.len());
    env.storage().instance().set(&DataKey::TotalAmount, &total);
}

pub fn payer(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Payer).unwrap()
}

pub fn payee(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Payee).unwrap()
}

pub fn arbiter(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::Arbiter)
}

pub fn set_arbiter(env: &Env, new_arbiter: Option<Address>) {
    match &new_arbiter {
        Some(a) => env.storage().instance().set(&DataKey::Arbiter, a),
        None => env.storage().instance().remove(&DataKey::Arbiter),
    }
}

pub fn token(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Token).unwrap()
}

pub fn timelock_duration(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::TimelockDuration)
        .unwrap()
}

pub fn total_amount(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::TotalAmount).unwrap()
}

/// True once every milestone has been individually funded. There's no stored
/// deal-level flag anymore — funding happens per milestone (installments),
/// so "fully funded" is just a computed aggregate over them.
pub fn all_funded(env: &Env) -> bool {
    let count = milestone_count(env);
    for i in 0..count {
        if !get_milestone(env, i).funded {
            return false;
        }
    }
    true
}

pub fn is_cancelled(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::Cancelled)
        .unwrap_or(false)
}

pub fn set_cancelled(env: &Env, cancelled: bool) {
    env.storage().instance().set(&DataKey::Cancelled, &cancelled);
}

pub fn milestone_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::MilestoneCount)
        .unwrap_or(0)
}

pub fn get_milestone(env: &Env, id: u32) -> Milestone {
    if id >= milestone_count(env) {
        panic_with_error!(env, EscrowError::InvalidMilestoneId);
    }
    env.storage()
        .persistent()
        .get(&DataKey::Milestone(id))
        .unwrap()
}

pub fn set_milestone(env: &Env, id: u32, milestone: &Milestone) {
    env.storage().persistent().set(&DataKey::Milestone(id), milestone);
}

pub fn cancel_vote(env: &Env, voter_is_payer: bool) -> bool {
    let key = if voter_is_payer {
        DataKey::CancelVotePayer
    } else {
        DataKey::CancelVotePayee
    };
    env.storage().instance().get(&key).unwrap_or(false)
}

pub fn set_cancel_vote(env: &Env, voter_is_payer: bool) {
    let key = if voter_is_payer {
        DataKey::CancelVotePayer
    } else {
        DataKey::CancelVotePayee
    };
    env.storage().instance().set(&key, &true);
}
