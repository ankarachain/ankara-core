use ankara_common::{
    oracle::OracleClient,
    roles::{self, require_role, Role},
};
use soroban_sdk::{
    contract, contractclient, contractimpl, contracttype, panic_with_error, symbol_short, token,
    Address, BytesN, Env, Symbol, Vec,
};

use crate::errors::RiskPoolError;
use crate::types::{Policy, PolicyStatus, Product, ProductStatus, Subject, Trigger};

const DAY_IN_LEDGERS: u32 = 17280;
const BUMP_AMOUNT: u32 = 365 * DAY_IN_LEDGERS;
const LIFETIME_THRESHOLD: u32 = BUMP_AMOUNT - 30 * DAY_IN_LEDGERS;
const BPS: i128 = 10_000;
const MAX_SETTLE_BATCH: u32 = 25;

/// `attestation-registry`'s read surface used by `Trigger::ClaimMissing`.
#[contractclient(name = "ClaimRegistryClient")]
pub trait ClaimRegistry {
    fn has_valid_claim(env: Env, subject: Subject, claim_type: Symbol) -> bool;
}

/// Balance read for asset-linked cover (any SEP-41 token).
#[contractclient(name = "BalanceClient")]
pub trait BalanceOf {
    fn balance(env: Env, id: Address) -> i128;
}

#[contracttype]
enum DataKey {
    PayoutToken,
    /// Funds not reserved against any active product's exposure.
    FreeCapital,
    TotalExposure,
    NextProductId,
    NextPolicyId,
    Product(u64),
    Policy(u64),
    ProductPolicies(u64),
    HolderPolicies(Address),
}

/// Parametric risk pool: automatic, threshold-based payouts for holders of
/// real-world assets — no claims adjuster in the common case.
///
/// - The insurer (Manager) defines **products**: a verifiable trigger
///   (`Trigger`), a coverage window, a premium rate, and optionally an
///   Ankara asset token the cover is linked to.
/// - Capital providers **fund** the pool; every policy's full coverage is
///   reserved out of free capital when sold, so the pool is always able to
///   pay every policy of a product that triggers.
/// - Holders **buy policies** (premium goes to free capital). For
///   asset-linked products, `buy_policy_for_holding` sizes coverage from
///   the holder's token balance, and the payout is capped by the balance
///   they still hold when it fires.
/// - Once the trigger condition is observed inside the window, anyone calls
///   `trigger`, then anyone can `settle` policies — payouts go straight to
///   the policyholders.
/// - Products that end without triggering are `expire`d, releasing their
///   reserve back to free capital (which the Manager may withdraw).
#[contract]
pub struct RiskPool;

#[contractimpl]
impl RiskPool {
    pub fn initialize(env: Env, admin: Address, payout_token: Address) {
        if roles::has_role(&env, Role::Manager) {
            panic_with_error!(&env, RiskPoolError::AlreadyInitialized);
        }
        roles::init_roles(&env, &admin);
        let s = env.storage().instance();
        s.set(&DataKey::PayoutToken, &payout_token);
        s.set(&DataKey::FreeCapital, &0i128);
        s.set(&DataKey::TotalExposure, &0i128);
    }

    // ─── Capital ─────────────────────────────────────────────────────────

    /// Anyone can add capital (the insurer, reinsurers, a donor fund).
    pub fn fund(env: Env, from: Address, amount: i128) {
        from.require_auth();
        if amount <= 0 {
            panic_with_error!(&env, RiskPoolError::InvalidAmount);
        }
        token::TokenClient::new(&env, &payout_token(&env)).transfer(
            &from,
            &env.current_contract_address(),
            &amount,
        );
        set_free(&env, free(&env) + amount);
        env.events().publish((symbol_short!("funded"), from), amount);
    }

    /// Manager withdraws unreserved capital.
    pub fn withdraw_capital(env: Env, to: Address, amount: i128) {
        require_role(&env, Role::Manager);
        if amount <= 0 || amount > free(&env) {
            panic_with_error!(&env, RiskPoolError::InsufficientCapital);
        }
        set_free(&env, free(&env) - amount);
        token::TokenClient::new(&env, &payout_token(&env)).transfer(
            &env.current_contract_address(),
            &to,
            &amount,
        );
        env.events().publish((symbol_short!("withdrawn"), to), amount);
    }

    // ─── Products (Role::Manager) ────────────────────────────────────────

    /// Defines a product. For asset-linked cover pass `asset_token` with
    /// `coverage_per_unit`/`unit_scale` (e.g. $500 per whole 18-decimal
    /// token = `500_0000000, 10^18`); otherwise pass `None, 0, 1`.
    #[allow(clippy::too_many_arguments)]
    pub fn create_product(
        env: Env,
        trigger: Trigger,
        coverage_start: u64,
        coverage_end: u64,
        premium_bps: u32,
        asset_token: Option<Address>,
        coverage_per_unit: i128,
        unit_scale: i128,
    ) -> u64 {
        require_role(&env, Role::Manager);
        if coverage_start >= coverage_end
            || coverage_end <= env.ledger().timestamp()
            || premium_bps == 0
            || premium_bps > BPS as u32
            || unit_scale <= 0
            || (asset_token.is_some() && coverage_per_unit <= 0)
        {
            panic_with_error!(&env, RiskPoolError::InvalidProduct);
        }
        let id = next(&env, DataKey::NextProductId);
        let product = Product {
            id,
            trigger,
            coverage_start,
            coverage_end,
            premium_bps,
            asset_token,
            coverage_per_unit,
            unit_scale,
            status: ProductStatus::Active,
            exposure: 0,
            triggered_at: 0,
            observed_value: 0,
        };
        write_product(&env, &product);
        env.events()
            .publish((symbol_short!("product"), id), (coverage_start, coverage_end, premium_bps));
        id
    }

    // ─── Policies ────────────────────────────────────────────────────────

    /// Buys `coverage` of a (non asset-linked or asset-linked) product. The
    /// premium (`coverage × premium_bps`) is paid in the payout token.
    pub fn buy_policy(env: Env, holder: Address, product_id: u64, coverage: i128) -> u64 {
        holder.require_auth();
        let product = read_product(&env, product_id);
        issue(&env, holder, product, coverage, 0)
    }

    /// Asset-linked products: coverage sized from `holder`'s current
    /// balance of the product's asset token.
    pub fn buy_policy_for_holding(env: Env, holder: Address, product_id: u64) -> u64 {
        holder.require_auth();
        let product = read_product(&env, product_id);
        let asset = product
            .asset_token
            .clone()
            .unwrap_or_else(|| panic_with_error!(&env, RiskPoolError::NotAssetLinked));
        let units = BalanceClient::new(&env, &asset).balance(&holder);
        if units <= 0 {
            panic_with_error!(&env, RiskPoolError::NoHolding);
        }
        let coverage = units * product.coverage_per_unit / product.unit_scale;
        issue(&env, holder, product, coverage, units)
    }

    // ─── Trigger & settlement (permissionless) ───────────────────────────

    /// Checks the product's condition and, if met inside the coverage
    /// window, marks it triggered. Anyone can call — typically a keeper
    /// watching the oracle.
    pub fn trigger(env: Env, product_id: u64) {
        let mut p = read_product(&env, product_id);
        if p.status != ProductStatus::Active {
            panic_with_error!(&env, RiskPoolError::ProductNotActive);
        }
        let now = env.ledger().timestamp();
        if now < p.coverage_start || now > p.coverage_end {
            panic_with_error!(&env, RiskPoolError::OutsideCoverageWindow);
        }
        let (met, observed) = evaluate(&env, &p.trigger);
        if !met {
            panic_with_error!(&env, RiskPoolError::ConditionNotMet);
        }
        p.status = ProductStatus::Triggered;
        p.triggered_at = now;
        p.observed_value = observed;
        write_product(&env, &p);
        env.events()
            .publish((symbol_short!("triggered"), product_id), (observed, now));
    }

    /// Whether `trigger` would succeed right now (for keepers/UIs).
    pub fn is_triggerable(env: Env, product_id: u64) -> bool {
        let p = read_product(&env, product_id);
        let now = env.ledger().timestamp();
        p.status == ProductStatus::Active
            && now >= p.coverage_start
            && now <= p.coverage_end
            && evaluate(&env, &p.trigger).0
    }

    /// Pays a policy of a triggered product to its holder. Anyone can call.
    /// Returns the amount paid (asset-linked cover is capped by the units
    /// the holder still holds). Any unpaid remainder returns to free capital.
    pub fn settle(env: Env, policy_id: u64) -> i128 {
        settle_one(&env, policy_id)
    }

    /// Settles up to 25 policies; skips ones already settled.
    pub fn settle_many(env: Env, policy_ids: Vec<u64>) -> i128 {
        if policy_ids.len() > MAX_SETTLE_BATCH {
            panic_with_error!(&env, RiskPoolError::InvalidAmount);
        }
        let mut total = 0;
        for id in policy_ids.iter() {
            if read_policy(&env, id).status == PolicyStatus::Active {
                total += settle_one(&env, id);
            }
        }
        total
    }

    /// After `coverage_end` without a trigger: releases the product's
    /// reserve back to free capital. Anyone can call.
    pub fn expire(env: Env, product_id: u64) {
        let mut p = read_product(&env, product_id);
        if p.status != ProductStatus::Active {
            panic_with_error!(&env, RiskPoolError::ProductNotActive);
        }
        if env.ledger().timestamp() <= p.coverage_end {
            panic_with_error!(&env, RiskPoolError::NotExpired);
        }
        release(&env, p.exposure);
        p.exposure = 0;
        p.status = ProductStatus::Expired;
        write_product(&env, &p);
        env.events().publish((symbol_short!("expired"), product_id), ());
    }

    // ─── Reads ───────────────────────────────────────────────────────────

    pub fn get_product(env: Env, product_id: u64) -> Product {
        read_product(&env, product_id)
    }

    /// For an expired product, its policies report `Expired`.
    pub fn get_policy(env: Env, policy_id: u64) -> Policy {
        let mut p = read_policy(&env, policy_id);
        if p.status == PolicyStatus::Active
            && read_product(&env, p.product_id).status == ProductStatus::Expired
        {
            p.status = PolicyStatus::Expired;
        }
        p
    }

    pub fn product_policies(env: Env, product_id: u64) -> Vec<u64> {
        list(&env, DataKey::ProductPolicies(product_id))
    }

    pub fn holder_policies(env: Env, holder: Address) -> Vec<u64> {
        list(&env, DataKey::HolderPolicies(holder))
    }

    /// Premium for `coverage` of a product.
    pub fn quote_premium(env: Env, product_id: u64, coverage: i128) -> i128 {
        coverage * (read_product(&env, product_id).premium_bps as i128) / BPS
    }

    pub fn free_capital(env: Env) -> i128 {
        free(&env)
    }

    pub fn total_exposure(env: Env) -> i128 {
        exposure(&env)
    }

    pub fn payout_token(env: Env) -> Address {
        payout_token(&env)
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        require_role(&env, Role::Upgrader);
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }
}

fn issue(env: &Env, holder: Address, mut product: Product, coverage: i128, units: i128) -> u64 {
    if product.status != ProductStatus::Active {
        panic_with_error!(env, RiskPoolError::ProductNotActive);
    }
    if env.ledger().timestamp() >= product.coverage_end {
        panic_with_error!(env, RiskPoolError::OutsideCoverageWindow);
    }
    if coverage <= 0 {
        panic_with_error!(env, RiskPoolError::InvalidAmount);
    }
    let premium = coverage * (product.premium_bps as i128) / BPS;
    if premium <= 0 {
        panic_with_error!(env, RiskPoolError::InvalidAmount);
    }
    // Reserve the full coverage: premium joins free capital first, then
    // coverage is carved out of it.
    let available = free(env) + premium;
    if coverage > available {
        panic_with_error!(env, RiskPoolError::InsufficientCapital);
    }
    set_free(env, available - coverage);
    set_exposure(env, exposure(env) + coverage);
    product.exposure += coverage;
    write_product(env, &product);

    let id = next(env, DataKey::NextPolicyId);
    let policy = Policy {
        id,
        product_id: product.id,
        holder: holder.clone(),
        coverage,
        premium,
        insured_units: units,
        status: PolicyStatus::Active,
        purchased_at: env.ledger().timestamp(),
        paid_amount: 0,
    };
    write_policy(env, &policy);
    push(env, DataKey::ProductPolicies(product.id), id);
    push(env, DataKey::HolderPolicies(holder.clone()), id);

    token::TokenClient::new(env, &payout_token(env)).transfer(
        &holder,
        &env.current_contract_address(),
        &premium,
    );
    env.events()
        .publish((symbol_short!("policy"), product.id, holder), (id, coverage, premium));
    id
}

fn settle_one(env: &Env, policy_id: u64) -> i128 {
    let mut policy = read_policy(env, policy_id);
    if policy.status != PolicyStatus::Active {
        panic_with_error!(env, RiskPoolError::PolicyNotActive);
    }
    let mut product = read_product(env, policy.product_id);
    if product.status != ProductStatus::Triggered {
        panic_with_error!(env, RiskPoolError::NotTriggered);
    }
    let mut payout = policy.coverage;
    if let Some(asset) = &product.asset_token {
        let held = BalanceClient::new(env, asset).balance(&policy.holder);
        let covered_units = held.min(policy.insured_units).max(0);
        payout = payout.min(covered_units * product.coverage_per_unit / product.unit_scale);
    }
    // Unpaid remainder of the reserve goes back to free capital.
    release(env, policy.coverage - payout);
    set_exposure(env, exposure(env) - payout);
    product.exposure -= policy.coverage;
    write_product(env, &product);
    policy.status = PolicyStatus::Paid;
    policy.paid_amount = payout;
    write_policy(env, &policy);
    if payout > 0 {
        token::TokenClient::new(env, &payout_token(env)).transfer(
            &env.current_contract_address(),
            &policy.holder,
            &payout,
        );
    }
    env.events()
        .publish((symbol_short!("paid"), policy.product_id, policy.holder), (policy_id, payout));
    payout
}

/// `(condition met, observed value)`.
fn evaluate(env: &Env, trigger: &Trigger) -> (bool, i128) {
    match trigger {
        Trigger::OracleBelow(oracle, key, threshold) | Trigger::OracleAbove(oracle, key, threshold) => {
            let client = OracleClient::new(env, oracle);
            if client.is_stale(key) {
                panic_with_error!(env, RiskPoolError::StaleReading);
            }
            let (value, _) = client.get_price(key);
            let met = match trigger {
                Trigger::OracleBelow(..) => value < *threshold,
                _ => value > *threshold,
            };
            (met, value)
        }
        Trigger::ClaimMissing(registry, subject, claim_type, deadline) => {
            if env.ledger().timestamp() <= *deadline {
                return (false, 0);
            }
            let confirmed = ClaimRegistryClient::new(env, registry).has_valid_claim(subject, claim_type);
            (!confirmed, 0)
        }
    }
}

/// Moves `amount` from reserved exposure back to free capital.
fn release(env: &Env, amount: i128) {
    if amount > 0 {
        set_exposure(env, exposure(env) - amount);
        set_free(env, free(env) + amount);
    }
}

fn payout_token(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::PayoutToken).unwrap()
}

fn free(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::FreeCapital).unwrap_or(0)
}

fn set_free(env: &Env, v: i128) {
    env.storage().instance().set(&DataKey::FreeCapital, &v);
}

fn exposure(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::TotalExposure).unwrap_or(0)
}

fn set_exposure(env: &Env, v: i128) {
    env.storage().instance().set(&DataKey::TotalExposure, &v);
}

fn next(env: &Env, key: DataKey) -> u64 {
    let id: u64 = env.storage().instance().get(&key).unwrap_or(0);
    env.storage().instance().set(&key, &(id + 1));
    id
}

fn read_product(env: &Env, id: u64) -> Product {
    env.storage()
        .persistent()
        .get(&DataKey::Product(id))
        .unwrap_or_else(|| panic_with_error!(env, RiskPoolError::ProductNotFound))
}

fn write_product(env: &Env, p: &Product) {
    let key = DataKey::Product(p.id);
    env.storage().persistent().set(&key, p);
    env.storage()
        .persistent()
        .extend_ttl(&key, LIFETIME_THRESHOLD, BUMP_AMOUNT);
}

fn read_policy(env: &Env, id: u64) -> Policy {
    env.storage()
        .persistent()
        .get(&DataKey::Policy(id))
        .unwrap_or_else(|| panic_with_error!(env, RiskPoolError::PolicyNotFound))
}

fn write_policy(env: &Env, p: &Policy) {
    let key = DataKey::Policy(p.id);
    env.storage().persistent().set(&key, p);
    env.storage()
        .persistent()
        .extend_ttl(&key, LIFETIME_THRESHOLD, BUMP_AMOUNT);
}

fn list(env: &Env, key: DataKey) -> Vec<u64> {
    env.storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| Vec::new(env))
}

fn push(env: &Env, key: DataKey, id: u64) {
    let mut ids: Vec<u64> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| Vec::new(env));
    ids.push_back(id);
    env.storage().persistent().set(&key, &ids);
    env.storage()
        .persistent()
        .extend_ttl(&key, LIFETIME_THRESHOLD, BUMP_AMOUNT);
}
