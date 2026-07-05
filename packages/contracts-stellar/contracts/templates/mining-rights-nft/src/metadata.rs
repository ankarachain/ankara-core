use soroban_sdk::{contracttype, BytesN, Env, String};

const DAY_IN_LEDGERS: u32 = 17280;
const METADATA_BUMP_AMOUNT: u32 = 90 * DAY_IN_LEDGERS;
const METADATA_LIFETIME_THRESHOLD: u32 = METADATA_BUMP_AMOUNT - DAY_IN_LEDGERS;

/// Direct port of `MiningRightsNFT.sol`'s `MiningRightsNFTMetadata` struct.
#[contracttype]
#[derive(Clone)]
pub struct MiningRightsNFTMetadata {
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
    Metadata(u64),
    Version(u64),
}

pub fn set_metadata(env: &Env, token_id: u64, mut metadata: MiningRightsNFTMetadata) -> u32 {
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

pub fn get_metadata(env: &Env, token_id: u64) -> MiningRightsNFTMetadata {
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

pub fn is_license_expired(env: &Env, token_id: u64) -> bool {
    env.ledger().timestamp() > get_metadata(env, token_id).license_expiry
}

pub fn renew_license(env: &Env, token_id: u64, new_expiry: u64) -> (u64, u32) {
    let mut metadata = get_metadata(env, token_id);
    let old = metadata.license_expiry;
    metadata.license_expiry = new_expiry;
    let version = set_metadata(env, token_id, metadata);
    (old, version)
}
