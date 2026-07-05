#![cfg(test)]

use ankara_common::AssetStatus;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, BytesN, Env, String,
};

use crate::contract::{MiningRightsToken, MiningRightsTokenClient};
use crate::metadata::MiningRightsMetadata;

fn sample_metadata(env: &Env, expiry: u64) -> MiningRightsMetadata {
    MiningRightsMetadata {
        license_number: String::from_str(env, "ML-2026-045"),
        mineral_type: String::from_str(env, "Gold"),
        concession_area: String::from_str(env, "Zamfara North"),
        area_hectares: 2_500,
        license_expiry: expiry,
        issuing_authority: String::from_str(env, "Nigerian Mining Cadastre"),
        license_document_hash: BytesN::from_array(env, &[12u8; 32]),
        royalty_rate_bps: 300,
        last_updated: 0,
    }
}

fn setup(env: &Env, expiry: u64) -> (Address, MiningRightsTokenClient<'_>) {
    let admin = Address::generate(env);
    let contract_id = env.register(MiningRightsToken, ());
    let client = MiningRightsTokenClient::new(env, &contract_id);
    client.initialize(
        &String::from_str(env, "Zamfara Gold Rights"),
        &String::from_str(env, "ZGR"),
        &BytesN::from_array(env, &[13u8; 32]),
        &String::from_str(env, "NG"),
        &admin,
        &None,
        &None,
        &sample_metadata(env, expiry),
    );
    (admin, client)
}

#[test]
fn declare_royalty_uses_rate_and_supply() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env, 999_999_999);
    let holder = Address::generate(&env);

    client.mint(&holder, &1_000);
    // royalty_rate_bps = 300 (3%) -> 100_000 * 0.03 = 3_000
    client.declare_royalty(&100_000);

    assert_eq!(client.total_royalties_declared(), 3_000);
}

#[test]
fn renew_license_updates_expiry() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env, 1_000);

    client.renew_license(&2_000_000);
    assert_eq!(client.get_metadata().license_expiry, 2_000_000);
    assert_eq!(client.metadata_version(), 2);
}

#[test]
fn mark_license_expired_after_expiry() {
    let env = Env::default();
    env.mock_all_auths();
    // ledger starts at timestamp 0 by default in the test env; set expiry
    // in the past relative to a later ledger timestamp bump.
    let (_, client) = setup(&env, 0);

    env.ledger().with_mut(|l| l.timestamp = 100);
    assert!(client.is_license_expired());

    client.mark_license_expired();
    assert_eq!(client.status(), AssetStatus::Expired);
}

#[test]
#[should_panic]
fn mark_license_expired_reverts_if_not_yet_expired() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env, 999_999_999);

    client.mark_license_expired();
}
