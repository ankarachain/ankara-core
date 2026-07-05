use soroban_sdk::{contracttype, Address, BytesN, String};

/// Local copy of `commodity-batch-token`'s `WarehouseMetadata` shape — see
/// `token-factory`'s Cargo.toml comment for why factories keep local
/// copies of metadata structs instead of depending on the template crates.
#[contracttype]
#[derive(Clone)]
pub struct WarehouseMetadata {
    pub warehouse_id: String,
    pub warehouse_location: String,
    pub operator_address: Address,
    pub warehouse_license_hash: BytesN<32>,
    pub certification_expiry: u64,
}
