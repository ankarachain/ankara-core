#![cfg(test)]

use soroban_sdk::{
    contract, contractimpl, contracttype,
    testutils::{Address as _, Ledger as _},
    vec, Address, BytesN, Env, String, Symbol,
};

use farmland_token::{FarmlandMetadata, FarmlandToken, FarmlandTokenClient};
use manual_oracle::{ManualOracle, ManualOracleClient};

use crate::contract::{RiskPool, RiskPoolClient};
use crate::types::{PolicyStatus, ProductStatus, Subject, Trigger};

const T0: u64 = 1_700_000_000;
const DAY: u64 = 86_400;
const E18: i128 = 1_000_000_000_000_000_000;

// ─── Mock attestation registry (has_valid_claim) ─────────────────────────

#[contracttype]
enum MockKey {
    Claim(Subject, Symbol),
}

#[contract]
pub struct MockRegistry;

#[contractimpl]
impl MockRegistry {
    pub fn confirm(env: Env, subject: Subject, claim_type: Symbol) {
        env.storage().instance().set(&MockKey::Claim(subject, claim_type), &true);
    }

    pub fn has_valid_claim(env: Env, subject: Subject, claim_type: Symbol) -> bool {
        env.storage().instance().has(&MockKey::Claim(subject, claim_type))
    }
}

fn token<'a>(env: &'a Env, admin: &Address, sym: &str) -> FarmlandTokenClient<'a> {
    let s = |v: &str| String::from_str(env, v);
    let id = env.register(FarmlandToken, ());
    let c = FarmlandTokenClient::new(env, &id);
    c.initialize(
        &s(sym), &s(sym), &BytesN::from_array(env, &[1u8; 32]), &s("NG"), admin, &None, &None,
        &FarmlandMetadata {
            location: s("Kaduna"), area_sq_meters: 10_000, soil_type: s("loam"), irrigation_type: s("rain-fed"),
            crop_history: s("maize"), title_document_hash: BytesN::from_array(env, &[0u8; 32]),
            valuation_usd: 0, state_region: s("Kaduna"), last_updated: 0,
        },
    );
    c
}

struct Setup<'a> {
    admin: Address,
    farmer: Address,
    usd: FarmlandTokenClient<'a>,
    oracle: ManualOracleClient<'a>,
    rain_index: Address,
    pool: RiskPoolClient<'a>,
}

fn setup(env: &Env) -> Setup<'_> {
    env.ledger().with_mut(|l| l.timestamp = T0);
    let admin = Address::generate(env);
    let farmer = Address::generate(env);
    let usd = token(env, &admin, "USDX");
    usd.mint(&admin, &1_000_000);
    usd.mint(&farmer, &10_000);
    let oracle_id = env.register(ManualOracle, ());
    let oracle = ManualOracleClient::new(env, &oracle_id);
    oracle.initialize(&admin, &(2 * DAY));
    let pool_id = env.register(RiskPool, ());
    let pool = RiskPoolClient::new(env, &pool_id);
    pool.initialize(&admin, &usd.address);
    pool.fund(&admin, &100_000);
    // The weather relayer publishes the season's cumulative rainfall (mm,
    // 1e18-scaled) under this key.
    let rain_index = Address::generate(env);
    Setup { admin, farmer, usd, oracle, rain_index, pool }
}

fn drought_product(t: &Setup) -> u64 {
    // Pays if rainfall is below 300mm during a 90-day season. 5% premium.
    t.pool.create_product(
        &Trigger::OracleBelow(t.oracle.address.clone(), t.rain_index.clone(), 300 * E18),
        &T0, &(T0 + 90 * DAY), &500, &None, &0, &1,
    )
}

#[test]
fn threshold_crossed_pays_automatically() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env);
    let product = drought_product(&t);
    assert_eq!(t.pool.quote_premium(&product, &2_000), 100);
    let policy = t.pool.buy_policy(&t.farmer, &product, &2_000);
    assert_eq!(t.usd.balance(&t.farmer), 9_900);
    assert_eq!(t.pool.total_exposure(), 2_000);
    assert_eq!(t.pool.free_capital(), 100_000 + 100 - 2_000);

    env.ledger().with_mut(|l| l.timestamp = T0 + 60 * DAY);
    t.oracle.set_price(&t.rain_index, &(180 * E18));
    assert!(t.pool.is_triggerable(&product));
    t.pool.trigger(&product);
    let p = t.pool.get_product(&product);
    assert_eq!(p.status, ProductStatus::Triggered);
    assert_eq!(p.observed_value, 180 * E18);

    // Anyone can settle — funds go to the policyholder.
    assert_eq!(t.pool.settle(&policy), 2_000);
    assert_eq!(t.usd.balance(&t.farmer), 11_900);
    assert_eq!(t.pool.get_policy(&policy).status, PolicyStatus::Paid);
    assert_eq!(t.pool.total_exposure(), 0);
    assert!(t.pool.try_settle(&policy).is_err());
}

#[test]
fn threshold_not_crossed_pays_nothing_and_expires() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env);
    let product = drought_product(&t);
    let policy = t.pool.buy_policy(&t.farmer, &product, &2_000);

    env.ledger().with_mut(|l| l.timestamp = T0 + 60 * DAY);
    t.oracle.set_price(&t.rain_index, &(450 * E18)); // good rains
    assert!(!t.pool.is_triggerable(&product));
    assert!(t.pool.try_trigger(&product).is_err());
    assert!(t.pool.try_settle(&policy).is_err());

    assert!(t.pool.try_expire(&product).is_err()); // window still open
    env.ledger().with_mut(|l| l.timestamp = T0 + 90 * DAY + 1);
    t.pool.expire(&product);
    assert_eq!(t.pool.get_product(&product).status, ProductStatus::Expired);
    assert_eq!(t.pool.get_policy(&policy).status, PolicyStatus::Expired);
    assert_eq!(t.pool.total_exposure(), 0);
    // Premium stays with the pool; capital can be withdrawn by the Manager.
    assert_eq!(t.pool.free_capital(), 100_100);
    t.pool.withdraw_capital(&t.admin, &100_100);
    assert_eq!(t.usd.balance(&t.pool.address), 0);
    // Too late to trigger now.
    t.oracle.set_price(&t.rain_index, &(1 * E18));
    assert!(t.pool.try_trigger(&product).is_err());
}

#[test]
fn stale_reading_cannot_trigger() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env);
    let product = drought_product(&t);
    t.oracle.set_price(&t.rain_index, &(10 * E18));
    env.ledger().with_mut(|l| l.timestamp = T0 + 3 * DAY);
    assert!(t.pool.try_trigger(&product).is_err());
}

#[test]
fn coverage_is_fully_reserved() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env);
    let product = drought_product(&t);
    // 100_000 capital; a 200_000 policy (premium 10_000) can't be covered.
    t.usd.mint(&t.farmer, &100_000);
    assert!(t.pool.try_buy_policy(&t.farmer, &product, &200_000).is_err());
    t.pool.buy_policy(&t.farmer, &product, &100_000);
    // Reserved capital can't be withdrawn.
    assert!(t.pool.try_withdraw_capital(&t.admin, &5_001).is_err());
    t.pool.withdraw_capital(&t.admin, &5_000);
}

#[test]
fn asset_linked_cover_sized_by_holding_and_capped_at_payout() {
    // Worked example: a farmland token's holders insure their share of the
    // harvest — $500 of cover per whole token, against drought.
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env);
    let farm = token(&env, &t.admin, "KDF");
    farm.mint(&t.farmer, &(4 * E18)); // holds 4 tokens
    let product = t.pool.create_product(
        &Trigger::OracleBelow(t.oracle.address.clone(), t.rain_index.clone(), 300 * E18),
        &T0, &(T0 + 90 * DAY), &400, &Some(farm.address.clone()), &500, &E18,
    );
    assert!(t.pool.try_buy_policy_for_holding(&Address::generate(&env), &product).is_err()); // no holding
    let policy = t.pool.buy_policy_for_holding(&t.farmer, &product);
    let p = t.pool.get_policy(&policy);
    assert_eq!(p.coverage, 2_000);
    assert_eq!(p.premium, 80);
    assert_eq!(p.insured_units, 4 * E18);

    // Farmer sells 1 token before the drought: payout covers the 3 held.
    farm.transfer(&t.farmer, &Address::generate(&env), &E18);
    t.oracle.set_price(&t.rain_index, &(100 * E18));
    t.pool.trigger(&product);
    assert_eq!(t.pool.settle_many(&vec![&env, policy]), 1_500);
    assert_eq!(t.pool.get_policy(&policy).paid_amount, 1_500);
    // The unpaid 500 of reserve went back to free capital.
    assert_eq!(t.pool.total_exposure(), 0);
    assert_eq!(t.pool.free_capital(), 100_000 + 80 - 1_500);
}

#[test]
fn missed_delivery_confirmation_triggers() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env);
    let reg_id = env.register(MockRegistry, ());
    let registry = MockRegistryClient::new(&env, &reg_id);
    let shipment = Subject::Asset(BytesN::from_array(&env, &[5u8; 32]));
    let delivery = Symbol::new(&env, "DELIVERY");
    let deadline = T0 + 30 * DAY;
    let make = || {
        t.pool.create_product(
            &Trigger::ClaimMissing(reg_id.clone(), shipment.clone(), delivery.clone(), deadline),
            &T0, &(T0 + 60 * DAY), &300, &None, &0, &1,
        )
    };

    // Case 1: confirmation arrives in time -> never triggers.
    let on_time = make();
    t.pool.buy_policy(&t.farmer, &on_time, &1_000);
    registry.confirm(&shipment, &delivery);
    env.ledger().with_mut(|l| l.timestamp = deadline + 1);
    assert!(!t.pool.is_triggerable(&on_time));

    // Case 2: a different shipment never confirmed -> triggers after deadline.
    let lost = Subject::Asset(BytesN::from_array(&env, &[6u8; 32]));
    let late = t.pool.create_product(
        &Trigger::ClaimMissing(reg_id.clone(), lost, delivery.clone(), deadline + 2),
        &T0, &(T0 + 60 * DAY), &300, &None, &0, &1,
    );
    let policy = t.pool.buy_policy(&t.farmer, &late, &1_000);
    assert!(t.pool.try_trigger(&late).is_err()); // before deadline
    env.ledger().with_mut(|l| l.timestamp = deadline + 3);
    t.pool.trigger(&late);
    assert_eq!(t.pool.settle(&policy), 1_000);
}

#[test]
fn oracle_above_trigger() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env);
    let heat = Address::generate(&env);
    let product = t.pool.create_product(
        &Trigger::OracleAbove(t.oracle.address.clone(), heat.clone(), 40 * E18),
        &T0, &(T0 + 30 * DAY), &200, &None, &0, &1,
    );
    t.pool.buy_policy(&t.farmer, &product, &500);
    t.oracle.set_price(&heat, &(38 * E18));
    assert!(!t.pool.is_triggerable(&product));
    t.oracle.set_price(&heat, &(43 * E18));
    t.pool.trigger(&product);
    assert_eq!(t.pool.holder_policies(&t.farmer).len(), 1);
    assert_eq!(t.pool.product_policies(&product).len(), 1);
}

#[test]
fn product_validation_and_auth() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env);
    let trig = Trigger::OracleBelow(t.oracle.address.clone(), t.rain_index.clone(), 1);
    assert!(t.pool.try_create_product(&trig, &(T0 + 10), &T0, &100, &None, &0, &1).is_err());
    assert!(t.pool.try_create_product(&trig, &T0, &(T0 + 10), &0, &None, &0, &1).is_err());
    assert!(t.pool.try_create_product(&trig, &T0, &(T0 + 10), &100, &Some(t.usd.address.clone()), &0, &1).is_err());
    let product = t.pool.create_product(&trig, &T0, &(T0 + 10), &100, &None, &0, &1);
    assert!(t.pool.try_buy_policy_for_holding(&t.farmer, &product).is_err()); // not asset-linked
}

#[test]
#[should_panic]
fn create_product_requires_manager() {
    let env = Env::default();
    env.ledger().with_mut(|l| l.timestamp = T0);
    let admin = Address::generate(&env);
    let pool_id = env.register(RiskPool, ());
    let pool = RiskPoolClient::new(&env, &pool_id);
    pool.initialize(&admin, &admin);
    pool.create_product(
        &Trigger::OracleBelow(admin.clone(), admin.clone(), 1),
        &T0, &(T0 + 10), &100, &None, &0, &1,
    );
}
