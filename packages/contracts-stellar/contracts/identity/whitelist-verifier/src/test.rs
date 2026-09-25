#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    vec, Address, BytesN, Env, String, Vec,
};

use farmland_token::{FarmlandMetadata, FarmlandToken, FarmlandTokenClient};

use crate::contract::{WhitelistVerifier, WhitelistVerifierClient};

fn setup(env: &Env) -> (Address, WhitelistVerifierClient<'_>) {
    env.ledger().with_mut(|l| l.timestamp = 1_700_000_000);
    let admin = Address::generate(env);
    let id = env.register(WhitelistVerifier, ());
    let client = WhitelistVerifierClient::new(env, &id);
    client.initialize(&admin);
    (admin, client)
}

fn deploy_gated_token<'a>(env: &'a Env, admin: &Address, verifier: &Address) -> FarmlandTokenClient<'a> {
    let id = env.register(FarmlandToken, ());
    let client = FarmlandTokenClient::new(env, &id);
    client.initialize(
        &String::from_str(env, "Farm"),
        &String::from_str(env, "FARM"),
        &BytesN::from_array(env, &[1u8; 32]),
        &String::from_str(env, "NG"),
        admin,
        &Some(verifier.clone()),
        &None,
        &FarmlandMetadata {
            location: String::from_str(env, "n/a"),
            area_sq_meters: 0,
            soil_type: String::from_str(env, "n/a"),
            irrigation_type: String::from_str(env, "n/a"),
            crop_history: String::from_str(env, "n/a"),
            title_document_hash: BytesN::from_array(env, &[0u8; 32]),
            valuation_usd: 0,
            state_region: String::from_str(env, "n/a"),
            last_updated: 0,
        },
    );
    client
}

#[test]
fn unverified_by_default_then_verify_and_revoke() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env);
    let user = Address::generate(&env);

    assert!(!client.is_verified(&user));
    client.verify(&user);
    assert!(client.is_verified(&user));
    let record = client.get_record(&user).unwrap();
    assert_eq!(record.verified_at, 1_700_000_000);
    assert_eq!(record.expires_at, 0);

    client.revoke(&user);
    assert!(!client.is_verified(&user));
    assert!(client.get_record(&user).is_none());
}

#[test]
fn verification_expires() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env);
    let user = Address::generate(&env);

    client.verify_until(&user, &(1_700_000_000 + 3_600));
    assert!(client.is_verified(&user));
    env.ledger().with_mut(|l| l.timestamp += 3_600);
    assert!(!client.is_verified(&user));
}

#[test]
#[should_panic]
fn verify_until_rejects_past_expiry() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env);
    client.verify_until(&Address::generate(&env), &1_000);
}

#[test]
fn batch_verify_and_revoke() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env);
    let a = Address::generate(&env);
    let b = Address::generate(&env);

    client.batch_verify(&vec![&env, a.clone(), b.clone()]);
    assert!(client.is_verified(&a));
    assert!(client.is_verified(&b));

    client.batch_revoke(&vec![&env, a.clone()]);
    assert!(!client.is_verified(&a));
    assert!(client.is_verified(&b));
}

#[test]
#[should_panic]
fn batch_verify_rejects_oversized_batch() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env);
    let mut accounts: Vec<Address> = Vec::new(&env);
    for _ in 0..51 {
        accounts.push_back(Address::generate(&env));
    }
    client.batch_verify(&accounts);
}

#[test]
#[should_panic]
fn verify_requires_admin_auth() {
    let env = Env::default();
    let (_, client) = setup(&env);
    client.verify(&Address::generate(&env));
}

#[test]
#[should_panic]
fn cannot_initialize_twice() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env);
    client.initialize(&Address::generate(&env));
}

#[test]
fn transfer_admin_moves_control() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env);
    let new_admin = Address::generate(&env);
    client.transfer_admin(&new_admin);
    assert_eq!(client.admin(), new_admin);
}

#[test]
fn gates_a_real_template_mint_and_transfer() {
    let env = Env::default();
    env.mock_all_auths();
    let (admin, verifier) = setup(&env);
    let token = deploy_gated_token(&env, &admin, &verifier.address);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    // Unverified recipient: mint is rejected.
    assert!(token.try_mint(&alice, &100).is_err());

    verifier.verify(&alice);
    token.mint(&alice, &100);
    assert_eq!(token.balance(&alice), 100);

    // Transfer to an unverified counterparty is rejected until verified.
    assert!(token.try_transfer(&alice, &bob, &10).is_err());
    verifier.verify(&bob);
    token.transfer(&alice, &bob, &10);
    assert_eq!(token.balance(&bob), 10);
}

#[test]
fn verifier_name_matches_evm() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env);
    assert_eq!(client.verifier_name(), String::from_str(&env, "WhitelistVerifier"));
}
