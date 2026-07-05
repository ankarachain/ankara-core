use soroban_sdk::{contracttype, vec, Address, BytesN, Env, String, Vec};

/// Direct port of `CommodityBatchToken.sol`'s `WarehouseMetadata` struct
/// (contract-level, one per deployed instance).
#[contracttype]
#[derive(Clone)]
pub struct WarehouseMetadata {
    pub warehouse_id: String,
    pub warehouse_location: String,
    pub operator_address: Address,
    pub warehouse_license_hash: BytesN<32>,
    pub certification_expiry: u64,
}

/// Direct port of `CommodityBatchToken.sol`'s `BatchMetadata` struct
/// (per token ID).
#[contracttype]
#[derive(Clone)]
pub struct BatchMetadata {
    pub commodity_type: String,
    pub quantity_kg: i128,
    pub grade_classification: String,
    pub deposit_date: u64,
    pub expiry_date: u64,
    pub inspection_report_hash: BytesN<32>,
    pub valuation_usd: i128,
    pub harvest_season: String,
    pub origin_country: String,
}

#[contracttype]
enum DataKey {
    Warehouse,
    ContractName,
    CountryCode,
    BaseUri,
    Batch(u64),
    BatchIds,
}

pub fn init_contract_metadata(
    env: &Env,
    name: String,
    country_code: String,
    base_uri: String,
    warehouse: WarehouseMetadata,
) {
    env.storage().instance().set(&DataKey::ContractName, &name);
    env.storage()
        .instance()
        .set(&DataKey::CountryCode, &country_code);
    env.storage().instance().set(&DataKey::BaseUri, &base_uri);
    env.storage().instance().set(&DataKey::Warehouse, &warehouse);
    env.storage()
        .instance()
        .set(&DataKey::BatchIds, &Vec::<u64>::new(env));
}

pub fn contract_name(env: &Env) -> String {
    env.storage().instance().get(&DataKey::ContractName).unwrap()
}

pub fn country_code(env: &Env) -> String {
    env.storage().instance().get(&DataKey::CountryCode).unwrap()
}

pub fn base_uri(env: &Env) -> String {
    env.storage().instance().get(&DataKey::BaseUri).unwrap()
}

pub fn warehouse_metadata(env: &Env) -> WarehouseMetadata {
    env.storage().instance().get(&DataKey::Warehouse).unwrap()
}

pub fn get_batch_metadata(env: &Env, id: u64) -> BatchMetadata {
    env.storage().persistent().get(&DataKey::Batch(id)).unwrap()
}

pub fn set_batch_metadata(env: &Env, id: u64, batch: &BatchMetadata) {
    env.storage().persistent().set(&DataKey::Batch(id), batch);
}

pub fn register_batch_id(env: &Env, id: u64, mut batch: BatchMetadata) {
    batch.deposit_date = env.ledger().timestamp();
    set_batch_metadata(env, id, &batch);
    let mut ids: Vec<u64> = env
        .storage()
        .instance()
        .get(&DataKey::BatchIds)
        .unwrap_or_else(|| vec![env]);
    ids.push_back(id);
    env.storage().instance().set(&DataKey::BatchIds, &ids);
}

pub fn batch_ids(env: &Env) -> Vec<u64> {
    env.storage()
        .instance()
        .get(&DataKey::BatchIds)
        .unwrap_or_else(|| vec![env])
}

pub fn is_naturally_expired(env: &Env, id: u64) -> bool {
    let expiry = get_batch_metadata(env, id).expiry_date;
    expiry > 0 && env.ledger().timestamp() > expiry
}
