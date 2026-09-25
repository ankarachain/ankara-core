use soroban_sdk::{contracttype, panic_with_error, Address, BytesN, Env, String, Symbol};

use crate::errors::AttestationError;

const DAY_IN_LEDGERS: u32 = 17280;
const BUMP_AMOUNT: u32 = 365 * DAY_IN_LEDGERS;
const LIFETIME_THRESHOLD: u32 = BUMP_AMOUNT - 30 * DAY_IN_LEDGERS;

/// What a claim is *about*. Accounts are wallet/contract addresses (KYC
/// status, credit signals); assets are the 32-byte `asset_id` every Ankara
/// template is initialized with (land-title chain of custody, delivery or
/// harvest confirmations against a specific asset).
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Subject {
    Account(Address),
    Asset(BytesN<32>),
}

/// A single typed claim. `claim_type` is a short `Symbol` chosen by the
/// integrator (e.g. `KYC`, `TITLE`, `DELIVERY`, `CREDIT`). `value` carries
/// the claim's numeric payload (a KYC tier, a credit score, `1`/`0` for a
/// boolean fact, a quantity delivered); `data` carries anything else — a
/// document hash, a registry reference, a URI, or a small JSON blob.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Attestation {
    pub id: u64,
    pub subject: Subject,
    pub claim_type: Symbol,
    pub attestor: Address,
    pub value: i128,
    pub data: String,
    pub timestamp: u64,
    /// `0` = never expires.
    pub expires_at: u64,
    pub revoked: bool,
}

impl Attestation {
    pub fn is_valid(&self, now: u64) -> bool {
        !self.revoked && (self.expires_at == 0 || now < self.expires_at)
    }
}

#[contracttype]
pub enum DataKey {
    Attestor(Address),
    NextId,
    Attestation(u64),
    /// Number of attestations ever posted for (subject, claim_type).
    ClaimCount(Subject, Symbol),
    /// (subject, claim_type, index) -> attestation id — an append-only,
    /// index-addressable history, so reads can be paginated rather than
    /// loading an ever-growing `Vec` on every write.
    ClaimAt(Subject, Symbol, u32),
    VerifierClaimType,
}

fn bump(env: &Env, key: &DataKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, LIFETIME_THRESHOLD, BUMP_AMOUNT);
}

pub fn is_attestor(env: &Env, addr: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::Attestor(addr.clone()))
        .unwrap_or(false)
}

pub fn set_attestor(env: &Env, addr: &Address, enabled: bool) {
    let key = DataKey::Attestor(addr.clone());
    if enabled {
        env.storage().persistent().set(&key, &true);
        bump(env, &key);
    } else {
        env.storage().persistent().remove(&key);
    }
}

pub fn next_id(env: &Env) -> u64 {
    let id: u64 = env.storage().instance().get(&DataKey::NextId).unwrap_or(0);
    env.storage().instance().set(&DataKey::NextId, &(id + 1));
    id
}

pub fn total(env: &Env) -> u64 {
    env.storage().instance().get(&DataKey::NextId).unwrap_or(0)
}

pub fn get(env: &Env, id: u64) -> Attestation {
    let key = DataKey::Attestation(id);
    let a = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| panic_with_error!(env, AttestationError::AttestationNotFound));
    bump(env, &key);
    a
}

pub fn set(env: &Env, a: &Attestation) {
    let key = DataKey::Attestation(a.id);
    env.storage().persistent().set(&key, a);
    bump(env, &key);
}

pub fn claim_count(env: &Env, subject: &Subject, claim_type: &Symbol) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::ClaimCount(subject.clone(), claim_type.clone()))
        .unwrap_or(0)
}

pub fn push_claim(env: &Env, subject: &Subject, claim_type: &Symbol, id: u64) {
    let count = claim_count(env, subject, claim_type);
    let at_key = DataKey::ClaimAt(subject.clone(), claim_type.clone(), count);
    env.storage().persistent().set(&at_key, &id);
    bump(env, &at_key);
    let count_key = DataKey::ClaimCount(subject.clone(), claim_type.clone());
    env.storage().persistent().set(&count_key, &(count + 1));
    bump(env, &count_key);
}

pub fn claim_at(env: &Env, subject: &Subject, claim_type: &Symbol, index: u32) -> u64 {
    env.storage()
        .persistent()
        .get(&DataKey::ClaimAt(subject.clone(), claim_type.clone(), index))
        .unwrap_or_else(|| panic_with_error!(env, AttestationError::AttestationNotFound))
}

pub fn verifier_claim_type(env: &Env) -> Symbol {
    env.storage()
        .instance()
        .get(&DataKey::VerifierClaimType)
        .unwrap_or_else(|| Symbol::new(env, "KYC"))
}

pub fn set_verifier_claim_type(env: &Env, claim_type: &Symbol) {
    env.storage()
        .instance()
        .set(&DataKey::VerifierClaimType, claim_type);
}
