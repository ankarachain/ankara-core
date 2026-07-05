use soroban_sdk::{contracttype, Address, BytesN, String};

// Local copies of each template's metadata struct, field-for-field
// identical to the ones defined in each `templates/*-token` crate (see the
// Cargo.toml note on why this crate can't just import them). Soroban
// `#[contracttype]` structs are XDR-encoded by field order/type, not by
// which crate declared them, so a shape-identical struct defined here
// round-trips correctly through `env.invoke_contract`'s cross-contract call
// into the real template contract's `initialize`.

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
#[derive(Clone)]
pub struct InvoiceMetadata {
    pub invoice_number: String,
    pub debtor_reference: String,
    pub face_value_usd: i128,
    pub discount_rate_bps: u32,
    pub issuance_date: u64,
    pub due_date: u64,
    pub invoice_document_hash: BytesN<32>,
    pub currency: String,
    pub last_updated: u64,
}

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
