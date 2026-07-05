use soroban_sdk::{contracttype, panic_with_error, Address, Env, Symbol};

use crate::errors::CommonError;

const DAY_IN_LEDGERS: u32 = 17280;
const OWNER_BUMP_AMOUNT: u32 = 90 * DAY_IN_LEDGERS;
const OWNER_LIFETIME_THRESHOLD: u32 = OWNER_BUMP_AMOUNT - DAY_IN_LEDGERS;

/// Custom ERC-721-equivalent ownership ledger — Soroban has no single
/// canonical NFT standard the way SEP-41 covers fungible tokens, so this is
/// a from-scratch port of `AnkaraNFTBase.sol`'s OZ-`ERC721Upgradeable`
/// usage: per-token owner, per-owner balance, single-token approval, and
/// operator-wide approval-for-all. Deliberately does not implement
/// `safeTransferFrom`'s receiver-callback check — Soroban has no analogous
/// "is this a contract that accepts NFTs" ecosystem convention today.
#[contracttype]
enum NftDataKey {
    Owner(u64),
    Balance(Address),
    Approved(u64),
    OperatorApproval(Address, Address), // (owner, operator)
    NextTokenId,
}

pub fn init_next_token_id(env: &Env) {
    env.storage().instance().set(&NftDataKey::NextTokenId, &1u64);
}

pub fn owner_of(env: &Env, token_id: u64) -> Address {
    env.storage()
        .persistent()
        .get(&NftDataKey::Owner(token_id))
        .unwrap_or_else(|| panic_with_error!(env, CommonError::TokenNotFound))
}

pub fn balance_of(env: &Env, owner: &Address) -> u64 {
    env.storage()
        .instance()
        .get(&NftDataKey::Balance(owner.clone()))
        .unwrap_or(0)
}

fn set_owner(env: &Env, token_id: u64, owner: &Address) {
    let key = NftDataKey::Owner(token_id);
    env.storage().persistent().set(&key, owner);
    env.storage()
        .persistent()
        .extend_ttl(&key, OWNER_LIFETIME_THRESHOLD, OWNER_BUMP_AMOUNT);
}

fn adjust_balance(env: &Env, owner: &Address, delta: i64) {
    let balance = balance_of(env, owner) as i64 + delta;
    env.storage()
        .instance()
        .set(&NftDataKey::Balance(owner.clone()), &(balance as u64));
}

/// Auto-increments and mints the next token ID to `to`, mirroring
/// `_mintNext(to)` (token IDs start at 1). Caller is responsible for the
/// `Role::Minter` check, identity verification, and any per-token metadata
/// write, same division of responsibility as the fungible `mint()` helper.
pub fn mint_next(env: &Env, to: &Address) -> u64 {
    crate::pausable::check_not_paused(env);
    let token_id: u64 = env
        .storage()
        .instance()
        .get(&NftDataKey::NextTokenId)
        .unwrap_or(1);
    env.storage()
        .instance()
        .set(&NftDataKey::NextTokenId, &(token_id + 1));
    set_owner(env, token_id, to);
    adjust_balance(env, to, 1);
    env.events()
        .publish((Symbol::new(env, "mint"), to.clone()), token_id);
    token_id
}

pub fn get_approved(env: &Env, token_id: u64) -> Option<Address> {
    env.storage().temporary().get(&NftDataKey::Approved(token_id))
}

pub fn is_approved_for_all(env: &Env, owner: &Address, operator: &Address) -> bool {
    env.storage()
        .temporary()
        .get(&NftDataKey::OperatorApproval(owner.clone(), operator.clone()))
        .unwrap_or(false)
}

fn is_authorized(env: &Env, spender: &Address, owner: &Address, token_id: u64) -> bool {
    spender == owner
        || get_approved(env, token_id).as_ref() == Some(spender)
        || is_approved_for_all(env, owner, spender)
}

/// Approves `approved` (or clears the approval if `None`) to transfer
/// `token_id` on the owner's behalf, mirroring OZ's `approve`/`getApproved`.
pub fn approve(env: &Env, owner: &Address, approved: Option<Address>, token_id: u64) {
    let actual_owner = owner_of(env, token_id);
    if actual_owner != *owner {
        panic_with_error!(env, CommonError::NotTokenOwner);
    }
    owner.require_auth();
    let key = NftDataKey::Approved(token_id);
    match approved {
        Some(addr) => env.storage().temporary().set(&key, &addr),
        None => env.storage().temporary().remove(&key),
    }
}

/// Approves or revokes `operator` for all of `owner`'s tokens, mirroring
/// `setApprovalForAll`/`isApprovedForAll`.
pub fn set_approval_for_all(env: &Env, owner: &Address, operator: &Address, approved: bool) {
    owner.require_auth();
    let key = NftDataKey::OperatorApproval(owner.clone(), operator.clone());
    if approved {
        env.storage().temporary().set(&key, &true);
    } else {
        env.storage().temporary().remove(&key);
    }
}

fn do_transfer(env: &Env, from: &Address, to: &Address, token_id: u64) {
    env.storage()
        .temporary()
        .remove(&NftDataKey::Approved(token_id));
    set_owner(env, token_id, to);
    adjust_balance(env, from, -1);
    adjust_balance(env, to, 1);
    env.events().publish(
        (Symbol::new(env, "transfer"), from.clone(), to.clone()),
        token_id,
    );
}

/// Direct owner-initiated transfer, mirroring `transferFrom(owner, to, id)`
/// called by the owner themselves (the common case; see
/// `transfer_from` below for the approval-based path).
pub fn transfer(env: &Env, from: &Address, to: &Address, token_id: u64) {
    crate::pausable::check_not_paused(env);
    from.require_auth();
    let owner = owner_of(env, token_id);
    if owner != *from {
        panic_with_error!(env, CommonError::NotTokenOwner);
    }
    do_transfer(env, &owner, to, token_id);
}

/// Approval-based transfer, mirroring OZ `ERC721Upgradeable.transferFrom`
/// when the caller is not the owner but holds an approval.
pub fn transfer_from(env: &Env, spender: &Address, from: &Address, to: &Address, token_id: u64) {
    crate::pausable::check_not_paused(env);
    spender.require_auth();
    let owner = owner_of(env, token_id);
    if owner != *from {
        panic_with_error!(env, CommonError::NotTokenOwner);
    }
    if !is_authorized(env, spender, &owner, token_id) {
        panic_with_error!(env, CommonError::NotApprovedOrOwner);
    }
    do_transfer(env, &owner, to, token_id);
}

/// Burns `token_id`, mirroring `ERC721BurnableUpgradeable.burn`.
pub fn burn(env: &Env, owner: &Address, token_id: u64) {
    crate::pausable::check_not_paused(env);
    owner.require_auth();
    let actual_owner = owner_of(env, token_id);
    if actual_owner != *owner {
        panic_with_error!(env, CommonError::NotTokenOwner);
    }
    env.storage().persistent().remove(&NftDataKey::Owner(token_id));
    env.storage()
        .temporary()
        .remove(&NftDataKey::Approved(token_id));
    adjust_balance(env, owner, -1);
    env.events()
        .publish((Symbol::new(env, "burn"), owner.clone()), token_id);
}
