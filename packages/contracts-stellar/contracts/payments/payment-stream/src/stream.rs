use soroban_sdk::{contracttype, panic_with_error, Address, Env, Vec};

use crate::errors::StreamError;

const DAY_IN_LEDGERS: u32 = 17280;
const BUMP_AMOUNT: u32 = 365 * DAY_IN_LEDGERS;
const LIFETIME_THRESHOLD: u32 = BUMP_AMOUNT - 30 * DAY_IN_LEDGERS;

/// One step of a step-vesting schedule: `amount` unlocks at `unlock_time`.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Tranche {
    pub unlock_time: u64,
    pub amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Schedule {
    /// Continuous per-second release from `start` to `end`. Nothing is
    /// claimable before `cliff`; at the cliff everything accrued since
    /// `start` unlocks at once (standard cliff-vesting semantics).
    Linear(u64, u64, u64), // (start, cliff, end)
    /// Discrete installments, sorted by unlock time.
    Tranches(Vec<Tranche>),
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Stream {
    pub id: u64,
    pub sender: Address,
    pub recipient: Address,
    pub token: Address,
    pub total_amount: i128,
    pub withdrawn: i128,
    pub schedule: Schedule,
    pub cancelable: bool,
    /// Set when cancelled — vesting stops at this timestamp.
    pub cancelled_at: u64,
    /// Unvested amount returned to the sender on cancellation.
    pub refunded: i128,
    pub created_at: u64,
}

impl Stream {
    /// Total amount vested at `now` (withdrawn or not).
    pub fn vested(&self, now: u64) -> i128 {
        let at = if self.cancelled_at != 0 && self.cancelled_at < now {
            self.cancelled_at
        } else {
            now
        };
        match &self.schedule {
            Schedule::Linear(start, cliff, end) => {
                if at < *cliff || at <= *start {
                    0
                } else if at >= *end {
                    self.total_amount
                } else {
                    self.total_amount * ((at - start) as i128) / ((end - start) as i128)
                }
            }
            Schedule::Tranches(tranches) => {
                let mut sum = 0;
                for t in tranches.iter() {
                    if t.unlock_time <= at {
                        sum += t.amount;
                    }
                }
                sum
            }
        }
    }

    pub fn claimable(&self, now: u64) -> i128 {
        self.vested(now) - self.withdrawn
    }

    pub fn is_closed(&self) -> bool {
        self.cancelled_at != 0 || self.withdrawn == self.total_amount
    }
}

#[contracttype]
enum DataKey {
    NextId,
    Stream(u64),
    BySender(Address),
    ByRecipient(Address),
}

pub fn next_id(env: &Env) -> u64 {
    let id: u64 = env.storage().instance().get(&DataKey::NextId).unwrap_or(0);
    env.storage().instance().set(&DataKey::NextId, &(id + 1));
    id
}

pub fn count(env: &Env) -> u64 {
    env.storage().instance().get(&DataKey::NextId).unwrap_or(0)
}

pub fn get(env: &Env, id: u64) -> Stream {
    env.storage()
        .persistent()
        .get(&DataKey::Stream(id))
        .unwrap_or_else(|| panic_with_error!(env, StreamError::StreamNotFound))
}

pub fn set(env: &Env, s: &Stream) {
    let key = DataKey::Stream(s.id);
    env.storage().persistent().set(&key, s);
    env.storage()
        .persistent()
        .extend_ttl(&key, LIFETIME_THRESHOLD, BUMP_AMOUNT);
}

fn push_index(env: &Env, key: DataKey, id: u64) {
    let mut ids: Vec<u64> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| Vec::new(env));
    ids.push_back(id);
    env.storage().persistent().set(&key, &ids);
    env.storage()
        .persistent()
        .extend_ttl(&key, LIFETIME_THRESHOLD, BUMP_AMOUNT);
}

pub fn index(env: &Env, s: &Stream) {
    push_index(env, DataKey::BySender(s.sender.clone()), s.id);
    push_index(env, DataKey::ByRecipient(s.recipient.clone()), s.id);
}

pub fn by_sender(env: &Env, a: &Address) -> Vec<u64> {
    env.storage()
        .persistent()
        .get(&DataKey::BySender(a.clone()))
        .unwrap_or_else(|| Vec::new(env))
}

pub fn by_recipient(env: &Env, a: &Address) -> Vec<u64> {
    env.storage()
        .persistent()
        .get(&DataKey::ByRecipient(a.clone()))
        .unwrap_or_else(|| Vec::new(env))
}
