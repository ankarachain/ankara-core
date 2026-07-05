use soroban_sdk::{contracttype, Address, BytesN, Env, String};

const DAY_IN_LEDGERS: u32 = 17280;
const METADATA_BUMP_AMOUNT: u32 = 90 * DAY_IN_LEDGERS;
const METADATA_LIFETIME_THRESHOLD: u32 = METADATA_BUMP_AMOUNT - DAY_IN_LEDGERS;

/// Direct port of `RealEstateNFT.sol`'s `RealEstateNFTMetadata` struct.
#[contracttype]
#[derive(Clone)]
pub struct RealEstateNFTMetadata {
    pub property_id: String,
    pub property_type: String,
    pub location_address: String,
    pub total_area_sq_meters: i128,
    pub title_document_hash: BytesN<32>,
    pub valuation_usd: i128,
    pub rental_yield_bps: u32,
    pub developer_address: Address,
    pub last_updated: u64,
}

#[contracttype]
enum MetaDataKey {
    Metadata(u64),
    Version(u64),
}

pub fn set_metadata(env: &Env, token_id: u64, mut metadata: RealEstateNFTMetadata) -> u32 {
    metadata.last_updated = env.ledger().timestamp();
    let key = MetaDataKey::Metadata(token_id);
    env.storage().persistent().set(&key, &metadata);
    env.storage()
        .persistent()
        .extend_ttl(&key, METADATA_LIFETIME_THRESHOLD, METADATA_BUMP_AMOUNT);

    let version_key = MetaDataKey::Version(token_id);
    let version: u32 = env.storage().persistent().get(&version_key).unwrap_or(0) + 1;
    env.storage().persistent().set(&version_key, &version);
    env.storage().persistent().extend_ttl(
        &version_key,
        METADATA_LIFETIME_THRESHOLD,
        METADATA_BUMP_AMOUNT,
    );
    version
}

pub fn get_metadata(env: &Env, token_id: u64) -> RealEstateNFTMetadata {
    env.storage()
        .persistent()
        .get(&MetaDataKey::Metadata(token_id))
        .unwrap()
}

pub fn metadata_version(env: &Env, token_id: u64) -> u32 {
    env.storage()
        .persistent()
        .get(&MetaDataKey::Version(token_id))
        .unwrap_or(0)
}

pub fn update_valuation(env: &Env, token_id: u64, new_valuation_usd: i128) -> (i128, u32) {
    let mut metadata = get_metadata(env, token_id);
    let old = metadata.valuation_usd;
    metadata.valuation_usd = new_valuation_usd;
    let version = set_metadata(env, token_id, metadata);
    (old, version)
}
