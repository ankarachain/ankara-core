use soroban_sdk::{contracttype, panic_with_error, Address, Env, String, Symbol};

use crate::errors::CommonError;

/// ~5s per ledger close -> ~17280 ledgers/day. Balance/allowance entries are
/// bumped 30 days out whenever touched, so active accounts never expire
/// mid-use — the Soroban analogue of EVM storage simply never expiring.
const DAY_IN_LEDGERS: u32 = 17280;
const BALANCE_BUMP_AMOUNT: u32 = 30 * DAY_IN_LEDGERS;
const BALANCE_LIFETIME_THRESHOLD: u32 = BALANCE_BUMP_AMOUNT - DAY_IN_LEDGERS;

#[contracttype]
enum FungibleDataKey {
    Balance(Address),
    Allowance(Address, Address), // (from, spender)
    Decimals,
    Name,
    Symbol,
    TotalSupply,
    /// Latest snapshot id (0 = no snapshot ever taken).
    SnapshotId,
    /// Per-account balance checkpoints, see `snapshot()`.
    BalanceCheckpoints(Address),
    SupplyCheckpoints,
}

/// `value` was the balance (or total supply) as of snapshot `id` — i.e. the
/// value just before the first change made after snapshot `id` was taken.
#[contracttype]
#[derive(Clone)]
pub struct Checkpoint {
    pub id: u32,
    pub value: i128,
}

#[contracttype]
#[derive(Clone)]
struct AllowanceValue {
    amount: i128,
    expiration_ledger: u32,
}

/// Sets the SEP-41 token metadata (name/symbol/decimals) — called once from
/// each template's `initialize()`, mirroring OZ's `__ERC20_init(name_,
/// symbol_)` plus the fixed 18-decimals convention used by the EVM templates.
pub fn init_metadata(env: &Env, decimals: u32, name: String, symbol: String) {
    env.storage()
        .instance()
        .set(&FungibleDataKey::Decimals, &decimals);
    env.storage().instance().set(&FungibleDataKey::Name, &name);
    env.storage()
        .instance()
        .set(&FungibleDataKey::Symbol, &symbol);
}

pub fn decimals(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&FungibleDataKey::Decimals)
        .unwrap()
}

pub fn name(env: &Env) -> String {
    env.storage().instance().get(&FungibleDataKey::Name).unwrap()
}

pub fn symbol(env: &Env) -> String {
    env.storage()
        .instance()
        .get(&FungibleDataKey::Symbol)
        .unwrap()
}

/// Soroban's SEP-41 interface has no `total_supply` method (unlike OZ's
/// `ERC20Upgradeable.totalSupply()`), but several templates' royalty/rental
/// math needs it (`declareRoyalty`, `declareRentalDistribution` on the EVM
/// side), so `mint`/`burn` here track it explicitly.
pub fn total_supply(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&FungibleDataKey::TotalSupply)
        .unwrap_or(0)
}

fn adjust_total_supply(env: &Env, delta: i128) {
    update_supply_checkpoint(env);
    let supply = total_supply(env) + delta;
    env.storage()
        .instance()
        .set(&FungibleDataKey::TotalSupply, &supply);
}

pub fn read_balance(env: &Env, addr: &Address) -> i128 {
    let key = FungibleDataKey::Balance(addr.clone());
    if let Some(balance) = env.storage().persistent().get::<_, i128>(&key) {
        env.storage().persistent().extend_ttl(
            &key,
            BALANCE_LIFETIME_THRESHOLD,
            BALANCE_BUMP_AMOUNT,
        );
        balance
    } else {
        0
    }
}

fn write_balance(env: &Env, addr: &Address, amount: i128) {
    update_balance_checkpoint(env, addr);
    let key = FungibleDataKey::Balance(addr.clone());
    env.storage().persistent().set(&key, &amount);
    env.storage()
        .persistent()
        .extend_ttl(&key, BALANCE_LIFETIME_THRESHOLD, BALANCE_BUMP_AMOUNT);
}

fn receive_balance(env: &Env, addr: &Address, amount: i128) {
    let balance = read_balance(env, addr);
    write_balance(env, addr, balance + amount);
}

fn spend_balance(env: &Env, addr: &Address, amount: i128) {
    let balance = read_balance(env, addr);
    if balance < amount {
        panic_with_error!(env, CommonError::InsufficientBalance);
    }
    write_balance(env, addr, balance - amount);
}

fn read_allowance(env: &Env, from: &Address, spender: &Address) -> AllowanceValue {
    let key = FungibleDataKey::Allowance(from.clone(), spender.clone());
    if let Some(v) = env.storage().temporary().get::<_, AllowanceValue>(&key) {
        if v.expiration_ledger < env.ledger().sequence() {
            AllowanceValue {
                amount: 0,
                expiration_ledger: v.expiration_ledger,
            }
        } else {
            v
        }
    } else {
        AllowanceValue {
            amount: 0,
            expiration_ledger: 0,
        }
    }
}

fn write_allowance(
    env: &Env,
    from: &Address,
    spender: &Address,
    amount: i128,
    expiration_ledger: u32,
) {
    let key = FungibleDataKey::Allowance(from.clone(), spender.clone());
    let value = AllowanceValue {
        amount,
        expiration_ledger,
    };
    env.storage().temporary().set(&key, &value);
    if amount > 0 {
        let live_for = expiration_ledger
            .checked_sub(env.ledger().sequence())
            .unwrap_or(0);
        env.storage()
            .temporary()
            .extend_ttl(&key, live_for, live_for);
    }
}

fn spend_allowance(env: &Env, from: &Address, spender: &Address, amount: i128) {
    let allowance = read_allowance(env, from, spender);
    if allowance.amount < amount {
        panic_with_error!(env, CommonError::InsufficientAllowance);
    }
    if amount > 0 {
        write_allowance(
            env,
            from,
            spender,
            allowance.amount - amount,
            allowance.expiration_ledger,
        );
    }
}

// ─── Snapshots (ERC20Snapshot-style) ──────────────────────────────────────
// SEP-41 has no historical balances, but pro-rata payouts (see
// `revenue-distributor`) need "who held what at time T". `snapshot()`
// bumps a counter; the first balance/supply change after a snapshot
// records the pre-change value as a checkpoint for that snapshot id.
// Tokens that never take a snapshot pay no extra storage cost: with
// `SnapshotId == 0` nothing is checkpointed.

const CHECKPOINT_BUMP_AMOUNT: u32 = 365 * DAY_IN_LEDGERS;
const CHECKPOINT_LIFETIME_THRESHOLD: u32 = CHECKPOINT_BUMP_AMOUNT - 30 * DAY_IN_LEDGERS;

pub fn current_snapshot_id(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&FungibleDataKey::SnapshotId)
        .unwrap_or(0)
}

/// Takes a new snapshot and returns its id (1, 2, ...). The caller (each
/// template's `snapshot` entry point) is responsible for the role check.
pub fn snapshot(env: &Env) -> u32 {
    let id = current_snapshot_id(env) + 1;
    env.storage().instance().set(&FungibleDataKey::SnapshotId, &id);
    env.events()
        .publish((Symbol::new(env, "snapshot"),), (id, env.ledger().timestamp()));
    id
}

fn push_checkpoint(env: &Env, key: FungibleDataKey, current: i128) {
    let snap = current_snapshot_id(env);
    if snap == 0 {
        return;
    }
    let mut list: soroban_sdk::Vec<Checkpoint> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| soroban_sdk::Vec::new(env));
    let already = list.last().map(|c| c.id >= snap).unwrap_or(false);
    if !already {
        list.push_back(Checkpoint { id: snap, value: current });
        env.storage().persistent().set(&key, &list);
        env.storage().persistent().extend_ttl(
            &key,
            CHECKPOINT_LIFETIME_THRESHOLD,
            CHECKPOINT_BUMP_AMOUNT,
        );
    }
}

fn update_balance_checkpoint(env: &Env, addr: &Address) {
    if current_snapshot_id(env) == 0 {
        return;
    }
    let current = read_balance(env, addr);
    push_checkpoint(env, FungibleDataKey::BalanceCheckpoints(addr.clone()), current);
}

fn update_supply_checkpoint(env: &Env) {
    if current_snapshot_id(env) == 0 {
        return;
    }
    push_checkpoint(env, FungibleDataKey::SupplyCheckpoints, total_supply(env));
}

/// First checkpoint with `id >= snapshot_id`, if any (binary search — ids
/// are strictly increasing).
fn value_at(env: &Env, key: FungibleDataKey, snapshot_id: u32) -> Option<i128> {
    let list: soroban_sdk::Vec<Checkpoint> = env.storage().persistent().get(&key)?;
    let (mut lo, mut hi) = (0u32, list.len());
    while lo < hi {
        let mid = (lo + hi) / 2;
        if list.get_unchecked(mid).id < snapshot_id {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    if lo < list.len() {
        Some(list.get_unchecked(lo).value)
    } else {
        None
    }
}

fn check_snapshot_id(env: &Env, snapshot_id: u32) {
    if snapshot_id == 0 || snapshot_id > current_snapshot_id(env) {
        panic_with_error!(env, CommonError::SnapshotNotFound);
    }
}

/// Balance of `addr` at the moment snapshot `snapshot_id` was taken.
pub fn balance_of_at(env: &Env, addr: &Address, snapshot_id: u32) -> i128 {
    check_snapshot_id(env, snapshot_id);
    value_at(env, FungibleDataKey::BalanceCheckpoints(addr.clone()), snapshot_id)
        .unwrap_or_else(|| read_balance(env, addr))
}

/// Total supply at the moment snapshot `snapshot_id` was taken.
pub fn total_supply_at(env: &Env, snapshot_id: u32) -> i128 {
    check_snapshot_id(env, snapshot_id);
    value_at(env, FungibleDataKey::SupplyCheckpoints, snapshot_id)
        .unwrap_or_else(|| total_supply(env))
}

// ─── SEP-41 (`soroban_sdk::token::TokenInterface`) bodies ──────────────────
// Each template's `#[contractimpl] impl TokenInterface for X` delegates
// straight into these functions.

pub fn allowance(env: &Env, from: &Address, spender: &Address) -> i128 {
    read_allowance(env, from, spender).amount
}

pub fn approve(env: &Env, from: &Address, spender: &Address, amount: i128, expiration_ledger: u32) {
    from.require_auth();
    write_allowance(env, from, spender, amount, expiration_ledger);
    env.events().publish(
        (Symbol::new(env, "approve"), from.clone(), spender.clone()),
        (amount, expiration_ledger),
    );
}

pub fn balance(env: &Env, id: &Address) -> i128 {
    read_balance(env, id)
}

pub fn transfer(env: &Env, from: &Address, to: &Address, amount: i128) {
    crate::pausable::check_not_paused(env);
    from.require_auth();
    spend_balance(env, from, amount);
    receive_balance(env, to, amount);
    env.events().publish(
        (Symbol::new(env, "transfer"), from.clone(), to.clone()),
        amount,
    );
}

pub fn transfer_from(env: &Env, spender: &Address, from: &Address, to: &Address, amount: i128) {
    crate::pausable::check_not_paused(env);
    spender.require_auth();
    spend_allowance(env, from, spender, amount);
    spend_balance(env, from, amount);
    receive_balance(env, to, amount);
    env.events().publish(
        (Symbol::new(env, "transfer"), from.clone(), to.clone()),
        amount,
    );
}

pub fn burn(env: &Env, from: &Address, amount: i128) {
    crate::pausable::check_not_paused(env);
    from.require_auth();
    spend_balance(env, from, amount);
    adjust_total_supply(env, -amount);
    env.events()
        .publish((Symbol::new(env, "burn"), from.clone()), amount);
}

pub fn burn_from(env: &Env, spender: &Address, from: &Address, amount: i128) {
    crate::pausable::check_not_paused(env);
    spender.require_auth();
    spend_allowance(env, from, spender, amount);
    spend_balance(env, from, amount);
    adjust_total_supply(env, -amount);
    env.events()
        .publish((Symbol::new(env, "burn"), from.clone()), amount);
}

/// Custom mint — SEP-41 itself defines no minting operation (same
/// reasoning as EVM: `mint()` is layered on top of the ERC-20 standard, not
/// part of it). The caller (each template's `contract.rs`) is responsible
/// for the `Role::Minter` check before calling this, same as every other
/// gated entry point in this codebase — checking the role here too would
/// call `require_auth()` on the same address twice in one invocation,
/// which Soroban's auth framework rejects.
pub fn mint(env: &Env, to: &Address, amount: i128) {
    crate::pausable::check_not_paused(env);
    receive_balance(env, to, amount);
    adjust_total_supply(env, amount);
    env.events()
        .publish((Symbol::new(env, "mint"), to.clone()), amount);
}
