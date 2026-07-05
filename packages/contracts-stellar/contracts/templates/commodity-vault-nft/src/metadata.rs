use soroban_sdk::{contracttype, Address, BytesN, Env, String};

const DAY_IN_LEDGERS: u32 = 17280;
const METADATA_BUMP_AMOUNT: u32 = 90 * DAY_IN_LEDGERS;
const METADATA_LIFETIME_THRESHOLD: u32 = METADATA_BUMP_AMOUNT - DAY_IN_LEDGERS;

/// Direct port of `CommodityVaultNFT.sol`'s `CommodityVaultNFTMetadata` struct.
#[contracttype]
#[derive(Clone)]
pub struct CommodityVaultNFTMetadata {
    pub warehouse_id: String,
    pub warehouse_location: String,
    pub operator_address: Address,
    pub commodity_type: String,
    pub quantity_kg: i128,
    pub grade_classification: String,
    pub certificate_hash: BytesN<32>,
    pub deposit_date: u64,
    pub last_updated: u64,
}

#[contracttype]
enum MetaDataKey {
    Metadata(u64),
    Version(u64),
}

pub fn set_metadata(env: &Env, token_id: u64, mut metadata: CommodityVaultNFTMetadata) -> u32 {
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

pub fn get_metadata(env: &Env, token_id: u64) -> CommodityVaultNFTMetadata {
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
