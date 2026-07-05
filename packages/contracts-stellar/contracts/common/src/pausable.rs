use soroban_sdk::{contracttype, panic_with_error, Env};

use crate::errors::CommonError;
use crate::roles::{require_role, Role};

/// Mirrors OZ's `PausableUpgradeable` usage on `AnkaraChainBaseToken`/
/// `AnkaraNFTBase`/`AnkaraMultiToken` — a single instance-storage flag
/// gated by `Role::Pauser`, checked at the top of every state-mutating
/// entry point (`fungible`/`nft`/`multi_token` call `check_not_paused`
/// internally so every template gets this for free).
#[contracttype]
enum PausableDataKey {
    Paused,
}

pub fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&PausableDataKey::Paused)
        .unwrap_or(false)
}

pub fn pause(env: &Env) {
    require_role(env, Role::Pauser);
    env.storage().instance().set(&PausableDataKey::Paused, &true);
}

pub fn unpause(env: &Env) {
    require_role(env, Role::Pauser);
    env.storage().instance().set(&PausableDataKey::Paused, &false);
}

pub fn check_not_paused(env: &Env) {
    if is_paused(env) {
        panic_with_error!(env, CommonError::ContractPaused);
    }
}
