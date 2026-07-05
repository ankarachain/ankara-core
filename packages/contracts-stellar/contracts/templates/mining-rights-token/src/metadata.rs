use soroban_sdk::{contracttype, BytesN, Env, String};

const DAY_IN_LEDGERS: u32 = 17280;
const METADATA_BUMP_AMOUNT: u32 = 90 * DAY_IN_LEDGERS;
const METADATA_LIFETIME_THRESHOLD: u32 = METADATA_BUMP_AMOUNT - DAY_IN_LEDGERS;

/// Direct port of `MiningRightsToken.sol`'s `MiningRightsMetadata` struct.
#[contracttype]
#[derive(Clone)]
pub struct MiningRightsMetadata {
    pub license_number: String,
    pub mineral_type: String,
    pub concession_area: String,
    pub area_hectares: i128,
    pub license_expiry: u64,
    pub issuing_authority: String,
    pub license_document_hash: BytesN<32>,
    pub royalty_rate_bps: u32,
    pub last_updated: u64,
}

#[contracttype]
enum MetaDataKey {
    Metadata,
    TotalRoyaltiesDeclared,
}

pub fn init_metadata(env: &Env, mut metadata: MiningRightsMetadata) {
    metadata.last_updated = env.ledger().timestamp();
    write_metadata(env, &metadata);
}

pub fn get_metadata(env: &Env) -> MiningRightsMetadata {
    env.storage()
        .persistent()
        .get(&MetaDataKey::Metadata)
        .unwrap()
}

fn write_metadata(env: &Env, metadata: &MiningRightsMetadata) {
    let key = MetaDataKey::Metadata;
    env.storage().persistent().set(&key, metadata);
    env.storage()
        .persistent()
        .extend_ttl(&key, METADATA_LIFETIME_THRESHOLD, METADATA_BUMP_AMOUNT);
}

pub fn update_metadata(env: &Env, mut metadata: MiningRightsMetadata) {
    metadata.last_updated = env.ledger().timestamp();
    write_metadata(env, &metadata);
}

pub fn is_license_expired(env: &Env) -> bool {
    env.ledger().timestamp() > get_metadata(env).license_expiry
}

pub fn days_until_expiry(env: &Env) -> i64 {
    (get_metadata(env).license_expiry as i64 - env.ledger().timestamp() as i64) / 86_400
}

pub fn total_royalties_declared(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&MetaDataKey::TotalRoyaltiesDeclared)
        .unwrap_or(0)
}

/// Mirrors `declareRoyalty()`'s `royaltyAmount = extractionValueUSD *
/// royaltyRateBps / 10000` and `perToken = royaltyAmount / supply`.
pub fn declare_royalty(env: &Env, extraction_value_usd: i128, supply: i128) -> (i128, i128) {
    let royalty_rate_bps = get_metadata(env).royalty_rate_bps as i128;
    let royalty_amount = (extraction_value_usd * royalty_rate_bps) / 10_000;
    let per_token = royalty_amount / supply;
    let total = total_royalties_declared(env) + royalty_amount;
    env.storage()
        .instance()
        .set(&MetaDataKey::TotalRoyaltiesDeclared, &total);
    (royalty_amount, per_token)
}

pub fn renew_license(env: &Env, new_expiry: u64) -> u64 {
    let mut metadata = get_metadata(env);
    let old = metadata.license_expiry;
    metadata.license_expiry = new_expiry;
    metadata.last_updated = env.ledger().timestamp();
    write_metadata(env, &metadata);
    old
}
