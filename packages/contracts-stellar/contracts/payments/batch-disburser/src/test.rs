#![cfg(test)]

use soroban_sdk::{testutils::Address as _, vec, Address, BytesN, Env, String, Vec};

use farmland_token::{FarmlandMetadata, FarmlandToken, FarmlandTokenClient};

use crate::contract::{BatchDisburser, BatchDisburserClient, Payment};

fn s(env: &Env, v: &str) -> String {
    String::from_str(env, v)
}

fn deploy_token<'a>(env: &'a Env, admin: &Address) -> FarmlandTokenClient<'a> {
    let id = env.register(FarmlandToken, ());
    let client = FarmlandTokenClient::new(env, &id);
    client.initialize(
        &s(env, "USD Stable"),
        &s(env, "USDX"),
        &BytesN::from_array(env, &[1u8; 32]),
        &s(env, "NG"),
        admin,
        &None,
        &None,
        &FarmlandMetadata {
            location: s(env, "n/a"),
            area_sq_meters: 0,
            soil_type: s(env, "n/a"),
            irrigation_type: s(env, "n/a"),
            crop_history: s(env, "n/a"),
            title_document_hash: BytesN::from_array(env, &[0u8; 32]),
            valuation_usd: 0,
            state_region: s(env, "n/a"),
            last_updated: 0,
        },
    );
    client
}

fn setup(env: &Env) -> (Address, FarmlandTokenClient<'_>, BatchDisburserClient<'_>) {
    let admin = Address::generate(env);
    let payer = Address::generate(env);
    let token = deploy_token(env, &admin);
    token.mint(&payer, &100_000);
    let id = env.register(BatchDisburser, ());
    (payer, token, BatchDisburserClient::new(env, &id))
}

#[test]
fn pays_every_recipient_in_one_call() {
    let env = Env::default();
    env.mock_all_auths();
    let (payer, token, d) = setup(&env);
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let c = Address::generate(&env);
    let total = d.disburse(
        &payer,
        &token.address,
        &vec![
            &env,
            Payment { recipient: a.clone(), amount: 100 },
            Payment { recipient: b.clone(), amount: 250 },
            Payment { recipient: c.clone(), amount: 650 },
        ],
        &s(&env, "payroll-2026-09"),
    );
    assert_eq!(total, 1_000);
    assert_eq!(token.balance(&a), 100);
    assert_eq!(token.balance(&b), 250);
    assert_eq!(token.balance(&c), 650);
    assert_eq!(token.balance(&payer), 99_000);
    // Funds never sit in the disburser.
    assert_eq!(token.balance(&d.address), 0);
}

#[test]
fn equal_split() {
    let env = Env::default();
    env.mock_all_auths();
    let (payer, token, d) = setup(&env);
    let members: Vec<Address> = vec![&env, Address::generate(&env), Address::generate(&env)];
    assert_eq!(d.disburse_equal(&payer, &token.address, &members, &50, &s(&env, "coop")), 100);
    for m in members.iter() {
        assert_eq!(token.balance(&m), 50);
    }
}

#[test]
fn batch_is_atomic() {
    let env = Env::default();
    env.mock_all_auths();
    let (payer, token, d) = setup(&env);
    let a = Address::generate(&env);
    let result = d.try_disburse(
        &payer,
        &token.address,
        &vec![
            &env,
            Payment { recipient: a.clone(), amount: 100 },
            Payment { recipient: Address::generate(&env), amount: 1_000_000 },
        ],
        &s(&env, "x"),
    );
    assert!(result.is_err());
    assert_eq!(token.balance(&a), 0);
    assert_eq!(token.balance(&payer), 100_000);
}

#[test]
fn rejects_empty_oversized_and_non_positive() {
    let env = Env::default();
    env.mock_all_auths();
    let (payer, token, d) = setup(&env);
    assert!(d.try_disburse(&payer, &token.address, &Vec::new(&env), &s(&env, "x")).is_err());
    let mut big = Vec::new(&env);
    for _ in 0..101 {
        big.push_back(Payment { recipient: Address::generate(&env), amount: 1 });
    }
    assert!(d.try_disburse(&payer, &token.address, &big, &s(&env, "x")).is_err());
    let zero = vec![&env, Payment { recipient: Address::generate(&env), amount: 0 }];
    assert!(d.try_disburse(&payer, &token.address, &zero, &s(&env, "x")).is_err());
    assert_eq!(d.max_payments(), 100);
}

#[test]
fn requires_payer_auth() {
    let env = Env::default();
    env.mock_all_auths();
    let (payer, token, d) = setup(&env);
    d.disburse(
        &payer,
        &token.address,
        &vec![&env, Payment { recipient: Address::generate(&env), amount: 1 }],
        &s(&env, "x"),
    );
    assert!(env.auths().iter().any(|(addr, _)| *addr == payer));
}
