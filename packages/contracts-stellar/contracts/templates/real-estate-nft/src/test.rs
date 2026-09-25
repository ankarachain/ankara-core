#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, String};

use crate::contract::{RealEstateNFT, RealEstateNFTClient};
use crate::metadata::RealEstateNFTMetadata;

fn sample_metadata(env: &Env, developer: &Address) -> RealEstateNFTMetadata {
    RealEstateNFTMetadata {
        property_id: String::from_str(env, "LR-2024-001"),
        property_type: String::from_str(env, "Residential"),
        location_address: String::from_str(env, "Lekki Phase 1, Lagos"),
        total_area_sq_meters: 450,
        title_document_hash: BytesN::from_array(env, &[4u8; 32]),
        valuation_usd: 250_000_0000000_i128,
        rental_yield_bps: 600,
        developer_address: developer.clone(),
        last_updated: 0,
    }
}

fn setup(env: &Env) -> (Address, RealEstateNFTClient<'_>) {
    let admin = Address::generate(env);
    let contract_id = env.register(RealEstateNFT, ());
    let client = RealEstateNFTClient::new(env, &contract_id);
    client.initialize(
        &BytesN::from_array(env, &[8u8; 32]),
        &String::from_str(env, "NG"),
        &admin,
        &None,
    );
    (admin, client)
}

#[test]
fn mint_and_update_valuation() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env);
    let holder = Address::generate(&env);
    let developer = Address::generate(&env);

    let token_id = client.mint(&holder, &sample_metadata(&env, &developer));
    assert_eq!(client.get_metadata(&token_id).valuation_usd, 250_000_0000000_i128);

    client.update_valuation(&token_id, &300_000_0000000_i128);
    assert_eq!(client.get_metadata(&token_id).valuation_usd, 300_000_0000000_i128);
    assert_eq!(client.metadata_version(&token_id), 2);
}

#[test]
fn title_flags_and_custody_log() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env);
    let holder = Address::generate(&env);
    let developer = Address::generate(&env);
    let id = client.mint(&holder, &sample_metadata(&env, &developer));
    let s = |v: &str| String::from_str(&env, v);

    client.set_lien(&id, &Some(s("Mortgage: FirstBank #2026-55")));
    assert!(client.title_flags(&id).liened);
    client.set_lien(&id, &None);
    assert!(!client.title_flags(&id).liened);

    client.append_custody(&id, &s("Lekki Dev Ltd"), &s("Governor's Consent LA-2019-1"), &1_560_000_000);
    client.append_custody(&id, &s("Adaeze Okafor"), &s("Deed 2023/88"), &1_690_000_000);
    assert_eq!(client.custody_count(&id), 2);
    assert_eq!(client.custody_log(&id, &0, &50).get(1).unwrap().owner, s("Adaeze Okafor"));
}
