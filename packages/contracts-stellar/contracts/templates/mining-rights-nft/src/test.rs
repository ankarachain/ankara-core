#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, BytesN, Env, String,
};

use crate::contract::{MiningRightsNFT, MiningRightsNFTClient};
use crate::metadata::MiningRightsNFTMetadata;

fn sample_metadata(env: &Env, expiry: u64) -> MiningRightsNFTMetadata {
    MiningRightsNFTMetadata {
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

fn setup(env: &Env) -> (Address, MiningRightsNFTClient<'_>) {
    let admin = Address::generate(env);
    let contract_id = env.register(MiningRightsNFT, ());
    let client = MiningRightsNFTClient::new(env, &contract_id);
    client.initialize(
        &BytesN::from_array(env, &[13u8; 32]),
        &String::from_str(env, "NG"),
        &admin,
        &None,
    );
    (admin, client)
}

#[test]
fn renew_license_updates_expiry() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env);
    let holder = Address::generate(&env);

    let token_id = client.mint(&holder, &sample_metadata(&env, 1_000));
    client.renew_license(&token_id, &2_000_000);

    assert_eq!(client.get_metadata(&token_id).license_expiry, 2_000_000);
    assert_eq!(client.metadata_version(&token_id), 2);
}

#[test]
fn is_license_expired_reflects_ledger_time() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env);
    let holder = Address::generate(&env);

    let token_id = client.mint(&holder, &sample_metadata(&env, 50));
    assert!(!client.is_license_expired(&token_id));

    env.ledger().with_mut(|l| l.timestamp = 100);
    assert!(client.is_license_expired(&token_id));
}
