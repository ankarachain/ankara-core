use soroban_sdk::{contracttype, BytesN, Env, String};

const DAY_IN_LEDGERS: u32 = 17280;
const METADATA_BUMP_AMOUNT: u32 = 90 * DAY_IN_LEDGERS;
const METADATA_LIFETIME_THRESHOLD: u32 = METADATA_BUMP_AMOUNT - DAY_IN_LEDGERS;

/// Direct port of `CommodityReceiptToken.sol`'s `CommodityMetadata` struct.
#[contracttype]
#[derive(Clone)]
pub struct CommodityMetadata {
    pub commodity_type: String,
    pub quantity_kg: i128,
    pub grade_classification: String,
    pub warehouse_id: String,
    pub warehouse_location: String,
    pub deposit_date: u64,
    pub expiry_date: u64,
    pub inspection_report_hash: BytesN<32>,
    pub valuation_usd: i128,
    pub harvest_season: String,
    pub last_updated: u64,
}

#[contracttype]
enum MetaDataKey {
    Metadata,
}

pub fn init_metadata(env: &Env, mut metadata: CommodityMetadata) {
    metadata.last_updated = env.ledger().timestamp();
    write_metadata(env, &metadata);
}

pub fn get_metadata(env: &Env) -> CommodityMetadata {
    env.storage()
        .persistent()
        .get(&MetaDataKey::Metadata)
        .unwrap()
}

fn write_metadata(env: &Env, metadata: &CommodityMetadata) {
    let key = MetaDataKey::Metadata;
    env.storage().persistent().set(&key, metadata);
    env.storage()
        .persistent()
        .extend_ttl(&key, METADATA_LIFETIME_THRESHOLD, METADATA_BUMP_AMOUNT);
}

pub fn update_metadata(env: &Env, mut metadata: CommodityMetadata) {
    metadata.last_updated = env.ledger().timestamp();
    write_metadata(env, &metadata);
}

pub fn is_expired(env: &Env) -> bool {
    env.ledger().timestamp() > get_metadata(env).expiry_date
}
