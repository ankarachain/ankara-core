use soroban_sdk::{contracttype, BytesN, Env, String};

const DAY_IN_LEDGERS: u32 = 17280;
const METADATA_BUMP_AMOUNT: u32 = 90 * DAY_IN_LEDGERS;
const METADATA_LIFETIME_THRESHOLD: u32 = METADATA_BUMP_AMOUNT - DAY_IN_LEDGERS;

/// Direct port of `InvoiceToken.sol`'s `InvoiceMetadata` struct.
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

/// Mirrors `InvoiceToken.sol`'s `InvoiceStatus` enum — a lifecycle
/// orthogonal to the shared `AssetStatus`, tracking invoice-specific state.
#[contracttype]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum InvoiceStatus {
    Pending,
    Funded,
    Repaid,
    Defaulted,
}

#[contracttype]
enum MetaDataKey {
    Metadata,
    InvoiceStatus,
}

pub fn init_metadata(env: &Env, mut metadata: InvoiceMetadata) {
    metadata.last_updated = env.ledger().timestamp();
    write_metadata(env, &metadata);
    env.storage()
        .instance()
        .set(&MetaDataKey::InvoiceStatus, &InvoiceStatus::Pending);
}

pub fn get_metadata(env: &Env) -> InvoiceMetadata {
    env.storage()
        .persistent()
        .get(&MetaDataKey::Metadata)
        .unwrap()
}

fn write_metadata(env: &Env, metadata: &InvoiceMetadata) {
    let key = MetaDataKey::Metadata;
    env.storage().persistent().set(&key, metadata);
    env.storage()
        .persistent()
        .extend_ttl(&key, METADATA_LIFETIME_THRESHOLD, METADATA_BUMP_AMOUNT);
}

pub fn update_metadata(env: &Env, mut metadata: InvoiceMetadata) {
    metadata.last_updated = env.ledger().timestamp();
    write_metadata(env, &metadata);
}

pub fn invoice_status(env: &Env) -> InvoiceStatus {
    env.storage()
        .instance()
        .get(&MetaDataKey::InvoiceStatus)
        .unwrap()
}

pub fn set_invoice_status(env: &Env, status: InvoiceStatus) {
    env.storage()
        .instance()
        .set(&MetaDataKey::InvoiceStatus, &status);
}

pub fn is_settled(env: &Env) -> bool {
    matches!(
        invoice_status(env),
        InvoiceStatus::Repaid | InvoiceStatus::Defaulted
    )
}

pub fn is_overdue(env: &Env) -> bool {
    env.ledger().timestamp() > get_metadata(env).due_date
        && invoice_status(env) == InvoiceStatus::Funded
}

pub fn days_until_due(env: &Env) -> i64 {
    (get_metadata(env).due_date as i64 - env.ledger().timestamp() as i64) / 86_400
}
