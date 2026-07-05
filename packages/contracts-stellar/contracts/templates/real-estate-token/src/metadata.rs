use soroban_sdk::{contracttype, Address, BytesN, Env, String};

const DAY_IN_LEDGERS: u32 = 17280;
const METADATA_BUMP_AMOUNT: u32 = 90 * DAY_IN_LEDGERS;
const METADATA_LIFETIME_THRESHOLD: u32 = METADATA_BUMP_AMOUNT - DAY_IN_LEDGERS;

/// Direct port of `RealEstateToken.sol`'s `RealEstateMetadata` struct.
#[contracttype]
#[derive(Clone)]
pub struct RealEstateMetadata {
    pub property_id: String,
    pub property_type: String,
    pub location_address: String,
    pub total_area_sq_meters: i128,
    pub title_document_hash: BytesN<32>,
    pub valuation_usd: i128,
    pub rental_yield_bps: u32,
    pub occupancy_status: String,
    pub developer_address: Address,
    pub last_updated: u64,
}

#[contracttype]
enum MetaDataKey {
    Metadata,
    TotalRentalDistributed,
}

pub fn init_metadata(env: &Env, mut metadata: RealEstateMetadata) {
    metadata.last_updated = env.ledger().timestamp();
    write_metadata(env, &metadata);
}

pub fn get_metadata(env: &Env) -> RealEstateMetadata {
    env.storage()
        .persistent()
        .get(&MetaDataKey::Metadata)
        .unwrap()
}

fn write_metadata(env: &Env, metadata: &RealEstateMetadata) {
    let key = MetaDataKey::Metadata;
    env.storage().persistent().set(&key, metadata);
    env.storage()
        .persistent()
        .extend_ttl(&key, METADATA_LIFETIME_THRESHOLD, METADATA_BUMP_AMOUNT);
}

pub fn update_metadata(env: &Env, mut metadata: RealEstateMetadata) -> (i128, i128) {
    let old_valuation = get_metadata(env).valuation_usd;
    metadata.last_updated = env.ledger().timestamp();
    let new_valuation = metadata.valuation_usd;
    write_metadata(env, &metadata);
    (old_valuation, new_valuation)
}

pub fn update_valuation(env: &Env, new_valuation_usd: i128) -> i128 {
    let mut metadata = get_metadata(env);
    let old = metadata.valuation_usd;
    metadata.valuation_usd = new_valuation_usd;
    metadata.last_updated = env.ledger().timestamp();
    write_metadata(env, &metadata);
    old
}

pub fn update_occupancy_status(env: &Env, new_status: String) -> String {
    let mut metadata = get_metadata(env);
    let old = metadata.occupancy_status.clone();
    metadata.occupancy_status = new_status;
    metadata.last_updated = env.ledger().timestamp();
    write_metadata(env, &metadata);
    old
}

pub fn total_rental_distributed(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&MetaDataKey::TotalRentalDistributed)
        .unwrap_or(0)
}

/// Adds `amount_usd` to the cumulative rental-distribution total and
/// returns the per-token USD amount, mirroring
/// `declareRentalDistribution()`'s `perToken = amountUSD / supply` split.
pub fn declare_rental_distribution(env: &Env, amount_usd: i128, supply: i128) -> i128 {
    let per_token = amount_usd / supply;
    let total = total_rental_distributed(env) + amount_usd;
    env.storage()
        .instance()
        .set(&MetaDataKey::TotalRentalDistributed, &total);
    per_token
}
