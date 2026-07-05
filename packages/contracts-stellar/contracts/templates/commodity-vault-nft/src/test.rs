#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, String};

use crate::contract::{CommodityVaultNFT, CommodityVaultNFTClient};
use crate::metadata::CommodityVaultNFTMetadata;

fn sample_metadata(env: &Env, operator: &Address) -> CommodityVaultNFTMetadata {
    CommodityVaultNFTMetadata {
        warehouse_id: String::from_str(env, "WH-VAULT-01"),
        warehouse_location: String::from_str(env, "Tema Port"),
        operator_address: operator.clone(),
        commodity_type: String::from_str(env, "cocoa"),
        quantity_kg: 5_000,
        grade_classification: String::from_str(env, "Grade A"),
        certificate_hash: BytesN::from_array(env, &[14u8; 32]),
        deposit_date: 1_000,
        last_updated: 0,
    }
}

fn setup(env: &Env) -> (Address, CommodityVaultNFTClient<'_>) {
    let admin = Address::generate(env);
    let contract_id = env.register(CommodityVaultNFT, ());
    let client = CommodityVaultNFTClient::new(env, &contract_id);
    client.initialize(
        &BytesN::from_array(env, &[15u8; 32]),
        &String::from_str(env, "GH"),
        &admin,
        &None,
    );
    (admin, client)
}

#[test]
fn mint_and_read_metadata() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env);
    let holder = Address::generate(&env);
    let operator = Address::generate(&env);

    let token_id = client.mint(&holder, &sample_metadata(&env, &operator));
    assert_eq!(client.owner_of(&token_id), holder);
    assert_eq!(client.get_metadata(&token_id).quantity_kg, 5_000);
}

#[test]
fn update_metadata_bumps_version() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env);
    let holder = Address::generate(&env);
    let operator = Address::generate(&env);

    let token_id = client.mint(&holder, &sample_metadata(&env, &operator));
    let mut updated = sample_metadata(&env, &operator);
    updated.quantity_kg = 4_800;
    client.update_metadata(&token_id, &updated);

    assert_eq!(client.get_metadata(&token_id).quantity_kg, 4_800);
    assert_eq!(client.metadata_version(&token_id), 2);
}
