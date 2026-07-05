use soroban_sdk::{contracttype, panic_with_error, Address, Env, String, Symbol};

use crate::asset::AssetStatus;
use crate::errors::CommonError;
use crate::verifier::IdentityVerifierClient;

/// Custom ERC-1155-equivalent ledger — Soroban has no native multi-ID
/// fungible-token standard, so this mirrors `AnkaraMultiToken.sol`'s own
/// from-scratch bookkeeping (it doesn't use an OZ ERC-1155 primitive
/// either): per-`(owner, id)` balances, a token-ID registry with
/// definitions, per-ID identity verifiers, and manually tracked per-ID
/// total supply.
#[contracttype]
#[derive(Clone)]
pub struct TokenDefinition {
    pub is_fungible: bool,
    pub name: String,
    pub symbol: String,
    pub max_supply: i128, // 0 = unlimited
    pub status: AssetStatus,
    pub metadata_uri: String,
}

#[contracttype]
enum MultiDataKey {
    Balance(Address, u64),
    Definition(u64),
    Verifier(u64),
    TotalSupply(u64),
}

pub fn is_registered(env: &Env, id: u64) -> bool {
    env.storage().persistent().has(&MultiDataKey::Definition(id))
}

/// Mirrors `registerTokenId(id, def)` [MANAGER_ROLE] — caller checks the role.
pub fn register_token_id(env: &Env, id: u64, def: TokenDefinition) {
    if is_registered(env, id) {
        panic_with_error!(env, CommonError::AlreadyRegistered);
    }
    env.storage()
        .persistent()
        .set(&MultiDataKey::Definition(id), &def);
    env.events().publish(
        (Symbol::new(env, "registered"), id),
        (def.is_fungible, def.name),
    );
}

pub fn get_token_definition(env: &Env, id: u64) -> TokenDefinition {
    env.storage()
        .persistent()
        .get(&MultiDataKey::Definition(id))
        .unwrap_or_else(|| panic_with_error!(env, CommonError::NotRegistered))
}

fn set_definition(env: &Env, id: u64, def: &TokenDefinition) {
    env.storage()
        .persistent()
        .set(&MultiDataKey::Definition(id), def);
}

/// Mirrors `setAssetStatus(id, newStatus)` [MANAGER_ROLE].
pub fn set_asset_status(env: &Env, id: u64, new_status: AssetStatus) {
    let mut def = get_token_definition(env, id);
    let old = def.status;
    def.status = new_status;
    set_definition(env, id, &def);
    env.events()
        .publish((Symbol::new(env, "status"), id), (old, new_status));
}

/// Mirrors `setTokenVerifier(id, verifier)` [MANAGER_ROLE].
pub fn set_token_verifier(env: &Env, id: u64, verifier: Option<Address>) {
    let key = MultiDataKey::Verifier(id);
    match &verifier {
        Some(addr) => env.storage().instance().set(&key, addr),
        None => env.storage().instance().remove(&key),
    }
    env.events()
        .publish((Symbol::new(env, "verifier"), id), verifier);
}

pub fn token_verifier(env: &Env, id: u64) -> Option<Address> {
    env.storage().instance().get(&MultiDataKey::Verifier(id))
}

pub fn check_verified(env: &Env, id: u64, account: &Address) {
    if let Some(verifier) = token_verifier(env, id) {
        let client = IdentityVerifierClient::new(env, &verifier);
        if !client.is_verified(account) {
            panic_with_error!(env, CommonError::NotVerified);
        }
    }
}

pub fn total_supply(env: &Env, id: u64) -> i128 {
    env.storage()
        .instance()
        .get(&MultiDataKey::TotalSupply(id))
        .unwrap_or(0)
}

fn adjust_total_supply(env: &Env, id: u64, delta: i128) {
    let supply = total_supply(env, id) + delta;
    env.storage()
        .instance()
        .set(&MultiDataKey::TotalSupply(id), &supply);
}

pub fn balance_of(env: &Env, owner: &Address, id: u64) -> i128 {
    env.storage()
        .persistent()
        .get(&MultiDataKey::Balance(owner.clone(), id))
        .unwrap_or(0)
}

fn write_balance(env: &Env, owner: &Address, id: u64, amount: i128) {
    env.storage()
        .persistent()
        .set(&MultiDataKey::Balance(owner.clone(), id), &amount);
}

fn receive(env: &Env, owner: &Address, id: u64, amount: i128) {
    let balance = balance_of(env, owner, id) + amount;
    write_balance(env, owner, id, balance);
}

fn spend(env: &Env, owner: &Address, id: u64, amount: i128) {
    let balance = balance_of(env, owner, id);
    if balance < amount {
        panic_with_error!(env, CommonError::InsufficientBalance);
    }
    write_balance(env, owner, id, balance - amount);
}

/// Mirrors `_mintChecked` — validates registration + `maxSupply` (0 =
/// unlimited) before crediting. Caller handles `Role::Minter` and identity
/// verification.
pub fn mint(env: &Env, to: &Address, id: u64, amount: i128) {
    crate::pausable::check_not_paused(env);
    let def = get_token_definition(env, id);
    if def.max_supply > 0 && total_supply(env, id) + amount > def.max_supply {
        panic_with_error!(env, CommonError::MaxSupplyExceeded);
    }
    adjust_total_supply(env, id, amount);
    receive(env, to, id, amount);
    env.events()
        .publish((Symbol::new(env, "mint"), to.clone(), id), amount);
}

pub fn transfer(env: &Env, from: &Address, to: &Address, id: u64, amount: i128) {
    crate::pausable::check_not_paused(env);
    from.require_auth();
    spend(env, from, id, amount);
    receive(env, to, id, amount);
    env.events().publish(
        (Symbol::new(env, "transfer"), from.clone(), to.clone()),
        (id, amount),
    );
}

pub fn burn(env: &Env, from: &Address, id: u64, amount: i128) {
    crate::pausable::check_not_paused(env);
    from.require_auth();
    spend(env, from, id, amount);
    adjust_total_supply(env, id, -amount);
    env.events()
        .publish((Symbol::new(env, "burn"), from.clone(), id), amount);
}

/// Manager-authorized internal burn+mint across two IDs for the same
/// holder, bypassing the holder's own authorization — mirrors
/// `mergeBatches()`'s direct `_burn`/`_mint` calls (a manager-authorised
/// operation, not something the holder initiates themselves).
pub fn admin_move(env: &Env, holder: &Address, from_id: u64, to_id: u64, amount: i128) {
    spend(env, holder, from_id, amount);
    adjust_total_supply(env, from_id, -amount);
    receive(env, holder, to_id, amount);
    adjust_total_supply(env, to_id, amount);
}
