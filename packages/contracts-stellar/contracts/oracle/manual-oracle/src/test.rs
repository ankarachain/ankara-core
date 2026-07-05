#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, Env,
};

use crate::contract::{ManualOracle, ManualOracleClient};

fn setup(env: &Env) -> (Address, Address, ManualOracleClient<'_>) {
    // The test env defaults to ledger timestamp 0, but `is_stale`
    // deliberately treats timestamp == 0 as "never set" (mirroring the EVM
    // source's `if (ts == 0) return true` verbatim) — a real chain's
    // block.timestamp is never 0, so bump the test ledger forward to avoid
    // colliding with that sentinel.
    env.ledger().with_mut(|l| l.timestamp = 1_700_000_000);
    let admin = Address::generate(env);
    let token = Address::generate(env);
    let contract_id = env.register(ManualOracle, ());
    let client = ManualOracleClient::new(env, &contract_id);
    client.initialize(&admin, &86_400);
    (admin, token, client)
}

#[test]
fn price_never_set_is_stale_and_zero() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, token, client) = setup(&env);

    assert_eq!(client.get_price(&token), (0, 0));
    assert!(client.is_stale(&token));
}

#[test]
fn set_price_then_read_back() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, token, client) = setup(&env);

    client.set_price(&token, &2_500_000_000_i128);
    let (price, timestamp) = client.get_price(&token);
    assert_eq!(price, 2_500_000_000_i128);
    assert_eq!(timestamp, env.ledger().timestamp());
    assert!(!client.is_stale(&token));
}

#[test]
fn price_becomes_stale_after_threshold() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, token, client) = setup(&env);

    client.set_price(&token, &1_000_i128);
    env.ledger().with_mut(|l| l.timestamp += 100_000);
    assert!(client.is_stale(&token));
}

#[test]
#[should_panic]
fn set_price_requires_manager_auth() {
    let env = Env::default();
    // no mock_all_auths — require_auth() should fail
    let (_, token, client) = setup(&env);
    client.set_price(&token, &1_000_i128);
}
