use soroban_sdk::{contracttype, Address, BytesN, Env, String};

const DAY_IN_LEDGERS: u32 = 17280;
const METADATA_BUMP_AMOUNT: u32 = 90 * DAY_IN_LEDGERS;
const METADATA_LIFETIME_THRESHOLD: u32 = METADATA_BUMP_AMOUNT - DAY_IN_LEDGERS;

/// Direct port of `CarbonCreditToken.sol`'s `CarbonCreditMetadata` struct.
#[contracttype]
#[derive(Clone)]
pub struct CarbonCreditMetadata {
    pub credit_type: String,
    pub verification_body_ref: String,
    pub vintage_year: u32,
    pub quantity_co2e: i128,
    pub project_location: String,
    pub project_type: String,
    pub verification_doc_hash: BytesN<32>,
    pub last_updated: u64,
}

/// Direct port of `CarbonCreditToken.sol`'s `RetirementRecord` struct.
#[contracttype]
#[derive(Clone)]
pub struct RetirementRecord {
    pub retired_by: Address,
    pub amount: i128,
    pub timestamp: u64,
    pub beneficiary: String,
    pub retirement_note: String,
}

#[contracttype]
enum MetaDataKey {
    Metadata,
    TotalRetired,
    RetirementCount,
    Retirement(u32),
}

pub fn init_metadata(env: &Env, mut metadata: CarbonCreditMetadata) {
    metadata.last_updated = env.ledger().timestamp();
    write_metadata(env, &metadata);
}

pub fn get_metadata(env: &Env) -> CarbonCreditMetadata {
    env.storage()
        .persistent()
        .get(&MetaDataKey::Metadata)
        .unwrap()
}

fn write_metadata(env: &Env, metadata: &CarbonCreditMetadata) {
    let key = MetaDataKey::Metadata;
    env.storage().persistent().set(&key, metadata);
    env.storage()
        .persistent()
        .extend_ttl(&key, METADATA_LIFETIME_THRESHOLD, METADATA_BUMP_AMOUNT);
}

pub fn update_metadata(env: &Env, mut metadata: CarbonCreditMetadata) {
    metadata.last_updated = env.ledger().timestamp();
    write_metadata(env, &metadata);
}

pub fn total_retired(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&MetaDataKey::TotalRetired)
        .unwrap_or(0)
}

pub fn total_retirements(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&MetaDataKey::RetirementCount)
        .unwrap_or(0)
}

pub fn get_retirement(env: &Env, index: u32) -> RetirementRecord {
    env.storage()
        .persistent()
        .get(&MetaDataKey::Retirement(index))
        .unwrap()
}

/// Appends a retirement record (keyed by an auto-incrementing index, the
/// Soroban analogue of Solidity's `RetirementRecord[] public retirements`
/// dynamic array) and bumps `total_retired`, returning the new record's
/// index — mirrors `retire()`'s `retirements.push(...)` and the
/// `CreditsRetired` event's `retirementIndex`.
pub fn record_retirement(
    env: &Env,
    retired_by: Address,
    amount: i128,
    beneficiary: String,
    retirement_note: String,
) -> u32 {
    let index = total_retirements(env);
    let key = MetaDataKey::Retirement(index);
    env.storage().persistent().set(
        &key,
        &RetirementRecord {
            retired_by,
            amount,
            timestamp: env.ledger().timestamp(),
            beneficiary,
            retirement_note,
        },
    );
    env.storage().persistent().extend_ttl(
        &key,
        METADATA_LIFETIME_THRESHOLD,
        METADATA_BUMP_AMOUNT,
    );
    env.storage()
        .instance()
        .set(&MetaDataKey::RetirementCount, &(index + 1));
    let total = total_retired(env) + amount;
    env.storage().instance().set(&MetaDataKey::TotalRetired, &total);
    index
}
