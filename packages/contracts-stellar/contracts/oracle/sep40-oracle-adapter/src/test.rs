#![cfg(test)]

use soroban_sdk::{
    contract, contractimpl, contracttype,
    testutils::{Address as _, Ledger as _},
    Address, BytesN, Env, String, Symbol, Vec,
};

use collateral_vault::{CollateralVault, CollateralVaultClient};
use farmland_token::{FarmlandMetadata, FarmlandToken, FarmlandTokenClient};
use manual_oracle::{ManualOracle, ManualOracleClient};
use pool_vault::{PoolVault, PoolVaultClient};

use crate::contract::{FeedConfig, Sep40OracleAdapter, Sep40OracleAdapterClient};
use crate::sep40::{Sep40Asset, Sep40PriceData};

const NOW: u64 = 1_700_000_000;
const E18: i128 = 1_000_000_000_000_000_000;

// ─── Mock SEP-40 feed (Reflector-shaped: 14 decimals) ────────────────────

#[contracttype]
enum MockKey {
    Decimals,
    History(Sep40Asset),
}

#[contract]
pub struct MockFeed;

#[contractimpl]
impl MockFeed {
    pub fn init(env: Env, decimals: u32) {
        env.storage().instance().set(&MockKey::Decimals, &decimals);
    }

    /// Pushes a record (newest last).
    pub fn push(env: Env, asset: Sep40Asset, price: i128, timestamp: u64) {
        let key = MockKey::History(asset);
        let mut h: Vec<Sep40PriceData> = env
            .storage()
            .instance()
            .get(&key)
            .unwrap_or_else(|| Vec::new(&env));
        h.push_back(Sep40PriceData { price, timestamp });
        env.storage().instance().set(&key, &h);
    }

    pub fn decimals(env: Env) -> u32 {
        env.storage().instance().get(&MockKey::Decimals).unwrap()
    }

    pub fn lastprice(env: Env, asset: Sep40Asset) -> Option<Sep40PriceData> {
        let h: Vec<Sep40PriceData> = env.storage().instance().get(&MockKey::History(asset))?;
        h.last()
    }

    pub fn prices(env: Env, asset: Sep40Asset, records: u32) -> Option<Vec<Sep40PriceData>> {
        let h: Vec<Sep40PriceData> = env.storage().instance().get(&MockKey::History(asset))?;
        let n = h.len();
        let start = n.saturating_sub(records);
        Some(h.slice(start..n))
    }
}

fn deploy_feed(env: &Env, decimals: u32) -> MockFeedClient<'_> {
    let id = env.register(MockFeed, ());
    let c = MockFeedClient::new(env, &id);
    c.init(&decimals);
    c
}

fn deploy_token<'a>(env: &'a Env, admin: &Address) -> FarmlandTokenClient<'a> {
    let s = |v: &str| String::from_str(env, v);
    let id = env.register(FarmlandToken, ());
    let client = FarmlandTokenClient::new(env, &id);
    client.initialize(
        &s("T"),
        &s("T"),
        &BytesN::from_array(env, &[1u8; 32]),
        &s("NG"),
        admin,
        &None,
        &None,
        &FarmlandMetadata {
            location: s("n/a"),
            area_sq_meters: 0,
            soil_type: s("n/a"),
            irrigation_type: s("n/a"),
            crop_history: s("n/a"),
            title_document_hash: BytesN::from_array(env, &[0u8; 32]),
            valuation_usd: 0,
            state_region: s("n/a"),
            last_updated: 0,
        },
    );
    client
}

struct Setup<'a> {
    admin: Address,
    feed: MockFeedClient<'a>,
    adapter: Sep40OracleAdapterClient<'a>,
}

fn setup(env: &Env, fallback: Option<Address>) -> Setup<'_> {
    env.ledger().with_mut(|l| l.timestamp = NOW);
    let admin = Address::generate(env);
    let feed = deploy_feed(env, 14);
    let id = env.register(Sep40OracleAdapter, ());
    let adapter = Sep40OracleAdapterClient::new(env, &id);
    adapter.initialize(&admin, &feed.address, &3_600, &fallback);
    Setup { admin, feed, adapter }
}

#[test]
fn scales_feed_price_to_1e18() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env, None);
    let token = Address::generate(&env);
    // $0.12 at 14 decimals.
    t.feed.push(&Sep40Asset::Stellar(token.clone()), &12_000_000_000_000, &(NOW - 10));
    assert_eq!(t.adapter.feed_decimals(), 14);
    assert_eq!(t.adapter.get_price(&token), (120_000_000_000_000_000, NOW - 10));
    assert!(!t.adapter.is_stale(&token));
}

#[test]
fn unknown_token_is_stale_and_zero_without_fallback() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env, None);
    let token = Address::generate(&env);
    assert_eq!(t.adapter.get_price(&token), (0, 0));
    assert!(t.adapter.is_stale(&token));
}

#[test]
fn old_feed_price_is_stale() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env, None);
    let token = Address::generate(&env);
    t.feed.push(&Sep40Asset::Stellar(token.clone()), &100_000_000_000_000, &(NOW - 3_601));
    assert!(t.adapter.is_stale(&token));
}

#[test]
fn millisecond_timestamps_are_normalized() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env, None);
    let token = Address::generate(&env);
    t.feed.push(&Sep40Asset::Stellar(token.clone()), &100_000_000_000_000, &((NOW - 5) * 1000));
    assert_eq!(t.adapter.get_price(&token).1, NOW - 5);
    assert!(!t.adapter.is_stale(&token));
}

#[test]
fn maps_token_to_ticker_and_twap() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env, None);
    let gold_token = Address::generate(&env);
    let xau = Sep40Asset::Other(Symbol::new(&env, "XAU"));
    t.feed.push(&xau, &100_000_000_000_000, &(NOW - 600));
    t.feed.push(&xau, &200_000_000_000_000, &(NOW - 300));
    t.feed.push(&xau, &300_000_000_000_000, &(NOW - 1));

    t.adapter.set_token_feed(&gold_token, &Some(FeedConfig { asset: xau.clone(), twap_records: 0 }));
    assert_eq!(t.adapter.get_price(&gold_token), (3 * E18, NOW - 1));

    t.adapter.set_token_feed(&gold_token, &Some(FeedConfig { asset: xau.clone(), twap_records: 3 }));
    assert_eq!(t.adapter.get_price(&gold_token), (2 * E18, NOW - 1));

    // Not enough history for the requested TWAP window -> no feed price.
    t.adapter.set_token_feed(&gold_token, &Some(FeedConfig { asset: xau, twap_records: 5 }));
    assert!(t.adapter.is_stale(&gold_token));

    t.adapter.set_token_feed(&gold_token, &None);
    assert_eq!(t.adapter.token_feed(&gold_token).asset, Sep40Asset::Stellar(gold_token));
}

#[test]
fn falls_back_to_manual_oracle_for_uncovered_assets() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = NOW);
    let admin = Address::generate(&env);
    let manual_id = env.register(ManualOracle, ());
    let manual = ManualOracleClient::new(&env, &manual_id);
    manual.initialize(&admin, &86_400);
    let t = setup(&env, Some(manual_id.clone()));

    let farmland = Address::generate(&env); // bespoke RWA: not on the feed
    let xlm = Address::generate(&env); // on the feed
    manual.set_price(&farmland, &(5 * E18));
    t.feed.push(&Sep40Asset::Stellar(xlm.clone()), &10_000_000_000_000, &NOW);

    assert_eq!(t.adapter.get_price(&farmland), (5 * E18, NOW));
    assert!(t.adapter.is_using_fallback(&farmland));
    assert!(!t.adapter.is_stale(&farmland));

    assert_eq!(t.adapter.get_price(&xlm), (E18 / 10, NOW));
    assert!(!t.adapter.is_using_fallback(&xlm));

    // Feed goes stale for xlm -> fallback (which has no xlm price) decides.
    env.ledger().with_mut(|l| l.timestamp = NOW + 3_601);
    assert!(t.adapter.is_using_fallback(&xlm));
    assert!(t.adapter.is_stale(&xlm));
    assert_eq!(t.adapter.feed_price(&xlm), (E18 / 10, NOW));

    t.adapter.set_fallback(&None);
    assert!(t.adapter.fallback().is_none());
    assert!(t.adapter.is_stale(&farmland));
}

#[test]
fn rejects_feeds_with_more_than_18_decimals() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env, None);
    let bad = deploy_feed(&env, 19);
    assert!(t.adapter.try_set_feed(&bad.address).is_err());
    let good = deploy_feed(&env, 7);
    t.adapter.set_feed(&good.address);
    assert_eq!(t.adapter.feed_decimals(), 7);
}

#[test]
#[should_panic]
fn admin_functions_require_auth() {
    let env = Env::default();
    env.ledger().with_mut(|l| l.timestamp = NOW);
    let admin = Address::generate(&env);
    let feed = deploy_feed(&env, 14);
    let id = env.register(Sep40OracleAdapter, ());
    let adapter = Sep40OracleAdapterClient::new(&env, &id);
    adapter.initialize(&admin, &feed.address, &3_600, &None);
    adapter.set_fallback(&Some(admin));
}

// ─── Drop-in for existing consumers (no contract changes) ────────────────

#[test]
fn collateral_vault_works_against_the_adapter() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let t = setup(&env, None);
    let borrower = Address::generate(&env);
    let collateral = deploy_token(&env, &t.admin);
    let borrowed = deploy_token(&env, &t.admin);
    // $1.00 at 14 decimals.
    t.feed.push(&Sep40Asset::Stellar(collateral.address.clone()), &100_000_000_000_000, &NOW);

    let vault_id = env.register(CollateralVault, ());
    let vault = CollateralVaultClient::new(&env, &vault_id);
    vault.initialize(&t.admin, &borrowed.address, &t.adapter.address, &6000u32, &7500u32);
    collateral.mint(&borrower, &1_000);
    borrowed.mint(&vault.address, &10_000);

    let loan_id = vault.open_loan(&borrower, &collateral.address, &1_000, &600);
    assert_eq!(borrowed.balance(&borrower), 600);
    // The borrower has pledged all their collateral.
    assert!(vault.try_open_loan(&borrower, &collateral.address, &1, &1).is_err());

    // Price halves on the feed -> loan becomes liquidatable.
    t.feed.push(&Sep40Asset::Stellar(collateral.address.clone()), &50_000_000_000_000, &NOW);
    assert!(vault.is_liquidatable(&loan_id));
}

#[test]
fn pool_vault_nav_works_against_the_adapter() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let t = setup(&env, None);
    let asset = deploy_token(&env, &t.admin);
    t.feed.push(&Sep40Asset::Stellar(asset.address.clone()), &100_000_000_000_000, &NOW);

    let s = |v: &str| String::from_str(&env, v);
    let vault_id = env.register(PoolVault, ());
    let vault = PoolVaultClient::new(&env, &vault_id);
    vault.initialize(
        &s("Basket"),
        &s("BSK"),
        &BytesN::from_array(&env, &[3u8; 32]),
        &s("NG"),
        &t.admin,
        &None,
        &None,
        &None,
        &0,
    );
    vault.add_accepted_token(&asset.address, &10_000);
    vault.set_oracle(&t.adapter.address);

    let investor = Address::generate(&env);
    asset.mint(&investor, &1_000);
    vault.deposit(&investor, &asset.address, &500);
    assert_eq!(vault.balance(&investor), 500);
    assert_eq!(vault.total_aum(), 500);

    t.feed.push(&Sep40Asset::Stellar(asset.address.clone()), &200_000_000_000_000, &NOW);
    assert_eq!(vault.total_aum(), 1_000);
}
