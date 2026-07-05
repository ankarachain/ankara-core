use soroban_sdk::{contracttype, Address, BytesN, Env};

/// Mirrors `RampSettlement.sol`'s `SettlementStatus` enum.
#[contracttype]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum SettlementStatus {
    None,
    Pending,
    Settled,
    Refunded,
    Recorded,
}

#[contracttype]
#[derive(Clone)]
pub struct OffRampDeposit {
    pub depositor: Address,
    pub token: Address,
    pub amount: i128,
    pub status: SettlementStatus,
    pub initiated_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct OnRampRecord {
    pub recipient: Address,
    pub token: Address,
    pub amount: i128,
    pub status: SettlementStatus,
    pub recorded_at: u64,
}

const DAY_IN_LEDGERS: u32 = 17280;
const RECORD_BUMP_AMOUNT: u32 = 180 * DAY_IN_LEDGERS;
const RECORD_LIFETIME_THRESHOLD: u32 = RECORD_BUMP_AMOUNT - DAY_IN_LEDGERS;

#[contracttype]
enum DataKey {
    Treasury,
    OffRamp(BytesN<32>),
    OnRamp(BytesN<32>),
}

pub fn init_treasury(env: &Env, treasury: &Address) {
    env.storage().instance().set(&DataKey::Treasury, treasury);
}

pub fn treasury(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Treasury).unwrap()
}

pub fn set_treasury(env: &Env, new_treasury: &Address) {
    env.storage().instance().set(&DataKey::Treasury, new_treasury);
}

pub fn off_ramp_status(env: &Env, reference_id: &BytesN<32>) -> SettlementStatus {
    get_off_ramp(env, reference_id)
        .map(|d| d.status)
        .unwrap_or(SettlementStatus::None)
}

pub fn get_off_ramp(env: &Env, reference_id: &BytesN<32>) -> Option<OffRampDeposit> {
    env.storage()
        .persistent()
        .get(&DataKey::OffRamp(reference_id.clone()))
}

pub fn set_off_ramp(env: &Env, reference_id: &BytesN<32>, deposit: &OffRampDeposit) {
    let key = DataKey::OffRamp(reference_id.clone());
    env.storage().persistent().set(&key, deposit);
    env.storage()
        .persistent()
        .extend_ttl(&key, RECORD_LIFETIME_THRESHOLD, RECORD_BUMP_AMOUNT);
}

pub fn on_ramp_status(env: &Env, reference_id: &BytesN<32>) -> SettlementStatus {
    get_on_ramp(env, reference_id)
        .map(|r| r.status)
        .unwrap_or(SettlementStatus::None)
}

pub fn get_on_ramp(env: &Env, reference_id: &BytesN<32>) -> Option<OnRampRecord> {
    env.storage()
        .persistent()
        .get(&DataKey::OnRamp(reference_id.clone()))
}

pub fn set_on_ramp(env: &Env, reference_id: &BytesN<32>, record: &OnRampRecord) {
    let key = DataKey::OnRamp(reference_id.clone());
    env.storage().persistent().set(&key, record);
    env.storage()
        .persistent()
        .extend_ttl(&key, RECORD_LIFETIME_THRESHOLD, RECORD_BUMP_AMOUNT);
}
