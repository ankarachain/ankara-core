#![cfg(test)]

use ankara_common::AssetStatus;
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, String};

use crate::contract::{FarmlandNFT, FarmlandNFTClient};
use crate::metadata::FarmlandNFTMetadata;

fn sample_metadata(env: &Env) -> FarmlandNFTMetadata {
    FarmlandNFTMetadata {
        location: String::from_str(env, "6.5244,3.3792"),
        area_sq_meters: 12_000,
        soil_type: String::from_str(env, "loam"),
        irrigation_type: String::from_str(env, "borehole"),
        crop_history: String::from_str(env, "maize,sorghum,fallow"),
        title_document_hash: BytesN::from_array(env, &[1u8; 32]),
        survey_report_hash: BytesN::from_array(env, &[2u8; 32]),
        state_region: String::from_str(env, "Kaduna"),
        last_updated: 0,
    }
}

fn setup(env: &Env) -> (Address, FarmlandNFTClient<'_>) {
    let admin = Address::generate(env);
    let contract_id = env.register(FarmlandNFT, ());
    let client = FarmlandNFTClient::new(env, &contract_id);
    client.initialize(
        &BytesN::from_array(env, &[9u8; 32]),
        &String::from_str(env, "NG"),
        &admin,
        &None,
    );
    (admin, client)
}

#[test]
fn mint_assigns_sequential_token_ids() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env);
    let holder = Address::generate(&env);

    let first = client.mint(&holder, &sample_metadata(&env));
    let second = client.mint(&holder, &sample_metadata(&env));

    assert_eq!(first, 1);
    assert_eq!(second, 2);
    assert_eq!(client.owner_of(&first), holder);
    assert_eq!(client.balance_of(&holder), 2);
    assert_eq!(client.metadata_version(&first), 1);
}

#[test]
fn transfer_moves_ownership() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env);
    let holder = Address::generate(&env);
    let recipient = Address::generate(&env);

    let token_id = client.mint(&holder, &sample_metadata(&env));
    client.transfer(&holder, &recipient, &token_id);

    assert_eq!(client.owner_of(&token_id), recipient);
    assert_eq!(client.balance_of(&holder), 0);
    assert_eq!(client.balance_of(&recipient), 1);
}

#[test]
fn approve_then_transfer_from() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env);
    let holder = Address::generate(&env);
    let approved = Address::generate(&env);
    let recipient = Address::generate(&env);

    let token_id = client.mint(&holder, &sample_metadata(&env));
    client.approve(&holder, &Some(approved.clone()), &token_id);
    assert_eq!(client.get_approved(&token_id), Some(approved.clone()));

    client.transfer_from(&approved, &holder, &recipient, &token_id);
    assert_eq!(client.owner_of(&token_id), recipient);
}

#[test]
#[should_panic]
fn transfer_from_reverts_without_approval() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env);
    let holder = Address::generate(&env);
    let stranger = Address::generate(&env);
    let recipient = Address::generate(&env);

    let token_id = client.mint(&holder, &sample_metadata(&env));
    client.transfer_from(&stranger, &holder, &recipient, &token_id);
}

#[test]
fn update_metadata_bumps_version() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env);
    let holder = Address::generate(&env);

    let token_id = client.mint(&holder, &sample_metadata(&env));
    let mut updated = sample_metadata(&env);
    updated.area_sq_meters = 15_000;
    client.update_metadata(&token_id, &updated);

    assert_eq!(client.get_metadata(&token_id).area_sq_meters, 15_000);
    assert_eq!(client.metadata_version(&token_id), 2);
}

#[test]
fn burn_removes_token() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env);
    let holder = Address::generate(&env);

    let token_id = client.mint(&holder, &sample_metadata(&env));
    client.burn(&holder, &token_id);
    assert_eq!(client.balance_of(&holder), 0);
}

#[test]
fn set_status_updates_lifecycle() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env);

    client.set_status(&AssetStatus::Active);
    assert_eq!(client.status(), AssetStatus::Active);
}
