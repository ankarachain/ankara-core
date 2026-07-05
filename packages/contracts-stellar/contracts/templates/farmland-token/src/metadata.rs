use soroban_sdk::{contracttype, BytesN, Env, String};

const DAY_IN_LEDGERS: u32 = 17280;
const METADATA_BUMP_AMOUNT: u32 = 90 * DAY_IN_LEDGERS;
const METADATA_LIFETIME_THRESHOLD: u32 = METADATA_BUMP_AMOUNT - DAY_IN_LEDGERS;

/// Direct port of `FarmlandToken.sol`'s `FarmlandMetadata` struct, field for field.
#[contracttype]
#[derive(Clone)]
pub struct FarmlandMetadata {
    pub location: String,
    pub area_sq_meters: i128,
    pub soil_type: String,
    pub irrigation_type: String,
    pub crop_history: String,
    pub title_document_hash: BytesN<32>,
    pub valuation_usd: i128,
    pub state_region: String,
    pub last_updated: u64,
}

#[contracttype]
enum MetaDataKey {
    Metadata,
}

pub fn init_metadata(env: &Env, mut metadata: FarmlandMetadata) {
    metadata.last_updated = env.ledger().timestamp();
    write_metadata(env, &metadata);
}

pub fn get_metadata(env: &Env) -> FarmlandMetadata {
    env.storage()
        .persistent()
        .get(&MetaDataKey::Metadata)
        .unwrap()
}

fn write_metadata(env: &Env, metadata: &FarmlandMetadata) {
    let key = MetaDataKey::Metadata;
    env.storage().persistent().set(&key, metadata);
    env.storage().persistent().extend_ttl(
        &key,
        METADATA_LIFETIME_THRESHOLD,
        METADATA_BUMP_AMOUNT,
    );
}

pub fn update_metadata(env: &Env, mut metadata: FarmlandMetadata) -> (i128, i128) {
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

pub fn update_title_document(env: &Env, new_hash: BytesN<32>) {
    let mut metadata = get_metadata(env);
    metadata.title_document_hash = new_hash;
    metadata.last_updated = env.ledger().timestamp();
    write_metadata(env, &metadata);
}
