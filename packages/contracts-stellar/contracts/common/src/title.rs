use soroban_sdk::{contracttype, panic_with_error, symbol_short, Address, Env, String, Vec};

use crate::errors::CommonError;
use crate::roles::{require_role, Role};

const DAY_IN_LEDGERS: u32 = 17280;
const BUMP_AMOUNT: u32 = 365 * DAY_IN_LEDGERS;
const LIFETIME_THRESHOLD: u32 = BUMP_AMOUNT - 30 * DAY_IN_LEDGERS;
/// Max entries returned by one `custody_log` page.
pub const MAX_CUSTODY_PAGE: u32 = 50;

/// Encumbrance flags on a land/property title NFT. A `reference` is kept
/// with each flag (court case number, lien registration ID, lender name)
/// so the flag is auditable, not just a boolean.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TitleFlags {
    pub disputed: bool,
    pub dispute_ref: String,
    pub liened: bool,
    pub lien_ref: String,
    pub updated_at: u64,
}

/// One append-only chain-of-custody entry. `owner` is a free-form string
/// because prior owners usually pre-date the token and have no Stellar
/// address (a name, a registry party ID, or an address rendered as text);
/// `reference` points at the deed / transfer instrument.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CustodyEntry {
    pub owner: String,
    pub reference: String,
    /// When the custody change happened (as stated by the recorder).
    pub effective_at: u64,
    /// When it was written on-chain.
    pub recorded_at: u64,
    pub recorded_by: Address,
}

#[contracttype]
enum TitleDataKey {
    Flags(u64),
    CustodyCount(u64),
    CustodyAt(u64, u32),
}

fn bump(env: &Env, key: &TitleDataKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, LIFETIME_THRESHOLD, BUMP_AMOUNT);
}

pub fn title_flags(env: &Env, token_id: u64) -> TitleFlags {
    env.storage()
        .persistent()
        .get(&TitleDataKey::Flags(token_id))
        .unwrap_or_else(|| TitleFlags {
            disputed: false,
            dispute_ref: String::from_str(env, ""),
            liened: false,
            lien_ref: String::from_str(env, ""),
            updated_at: 0,
        })
}

fn write_flags(env: &Env, token_id: u64, mut flags: TitleFlags) {
    flags.updated_at = env.ledger().timestamp();
    let key = TitleDataKey::Flags(token_id);
    env.storage().persistent().set(&key, &flags);
    bump(env, &key);
}

/// Sets (`Some(reference)`) or clears (`None`) the dispute flag. Manager only.
pub fn set_dispute(env: &Env, token_id: u64, reference: Option<String>) {
    require_role(env, Role::Manager);
    crate::nft::owner_of(env, token_id); // must exist
    let mut flags = title_flags(env, token_id);
    flags.disputed = reference.is_some();
    flags.dispute_ref = reference.clone().unwrap_or_else(|| String::from_str(env, ""));
    write_flags(env, token_id, flags);
    env.events()
        .publish((symbol_short!("dispute"), token_id), reference);
}

/// Sets (`Some(reference)`) or clears (`None`) the lien flag. Manager only.
pub fn set_lien(env: &Env, token_id: u64, reference: Option<String>) {
    require_role(env, Role::Manager);
    crate::nft::owner_of(env, token_id);
    let mut flags = title_flags(env, token_id);
    flags.liened = reference.is_some();
    flags.lien_ref = reference.clone().unwrap_or_else(|| String::from_str(env, ""));
    write_flags(env, token_id, flags);
    env.events().publish((symbol_short!("lien"), token_id), reference);
}

/// Appends a custody entry — there is no update or delete. Manager only.
/// Returns the new entry's index.
pub fn append_custody(
    env: &Env,
    token_id: u64,
    owner: String,
    reference: String,
    effective_at: u64,
) -> u32 {
    let recorder = require_role(env, Role::Manager);
    crate::nft::owner_of(env, token_id);
    let index = custody_count(env, token_id);
    let entry = CustodyEntry {
        owner: owner.clone(),
        reference,
        effective_at,
        recorded_at: env.ledger().timestamp(),
        recorded_by: recorder,
    };
    let at_key = TitleDataKey::CustodyAt(token_id, index);
    env.storage().persistent().set(&at_key, &entry);
    bump(env, &at_key);
    let count_key = TitleDataKey::CustodyCount(token_id);
    env.storage().persistent().set(&count_key, &(index + 1));
    bump(env, &count_key);
    env.events()
        .publish((symbol_short!("custody"), token_id), (index, owner));
    index
}

pub fn custody_count(env: &Env, token_id: u64) -> u32 {
    env.storage()
        .persistent()
        .get(&TitleDataKey::CustodyCount(token_id))
        .unwrap_or(0)
}

pub fn custody_at(env: &Env, token_id: u64, index: u32) -> CustodyEntry {
    env.storage()
        .persistent()
        .get(&TitleDataKey::CustodyAt(token_id, index))
        .unwrap_or_else(|| panic_with_error!(env, CommonError::TokenNotFound))
}

/// Oldest-first page of the custody log (max 50 per page).
pub fn custody_log(env: &Env, token_id: u64, start: u32, limit: u32) -> Vec<CustodyEntry> {
    let count = custody_count(env, token_id);
    let end = start.saturating_add(limit.min(MAX_CUSTODY_PAGE)).min(count);
    let mut out = Vec::new(env);
    let mut i = start;
    while i < end {
        out.push_back(custody_at(env, token_id, i));
        i += 1;
    }
    out
}
