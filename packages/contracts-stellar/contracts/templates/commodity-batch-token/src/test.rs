#![cfg(test)]

use soroban_sdk::{testutils::Address as _, vec, Address, BytesN, Env, String};

use crate::contract::{CommodityBatchToken, CommodityBatchTokenClient};
use crate::metadata::{BatchMetadata, WarehouseMetadata};

fn sample_batch(env: &Env, commodity: &str, grade: &str, quantity: i128) -> BatchMetadata {
    BatchMetadata {
        commodity_type: String::from_str(env, commodity),
        quantity_kg: quantity,
        grade_classification: String::from_str(env, grade),
        deposit_date: 0,
        expiry_date: 100_000,
        inspection_report_hash: BytesN::from_array(env, &[1u8; 32]),
        valuation_usd: 10_000_0000000_i128,
        harvest_season: String::from_str(env, "2025/2026"),
        origin_country: String::from_str(env, "GH"),
    }
}

fn setup(env: &Env) -> (Address, CommodityBatchTokenClient<'_>) {
    let admin = Address::generate(env);
    let operator = Address::generate(env);
    let contract_id = env.register(CommodityBatchToken, ());
    let client = CommodityBatchTokenClient::new(env, &contract_id);
    client.initialize(
        &String::from_str(env, "Tema Warehouse"),
        &String::from_str(env, "GH"),
        &String::from_str(env, "https://example.com/meta/"),
        &admin,
        &WarehouseMetadata {
            warehouse_id: String::from_str(env, "WH-001"),
            warehouse_location: String::from_str(env, "Tema Port"),
            operator_address: operator,
            warehouse_license_hash: BytesN::from_array(env, &[9u8; 32]),
            certification_expiry: 999_999_999,
        },
    );
    (admin, client)
}

#[test]
fn register_batch_and_mint() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env);
    let holder = Address::generate(&env);

    client.register_batch(&1, &sample_batch(&env, "cocoa", "Grade A", 1_000));
    client.mint(&holder, &1, &500);

    assert_eq!(client.balance_of(&holder, &1), 500);
    assert_eq!(client.total_supply(&1), 500);
}

#[test]
#[should_panic]
fn mint_exceeding_max_supply_reverts() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env);
    let holder = Address::generate(&env);

    client.register_batch(&1, &sample_batch(&env, "cocoa", "Grade A", 1_000));
    client.mint(&holder, &1, &1_500);
}

#[test]
fn merge_compatible_batches() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env);
    let holder = Address::generate(&env);

    client.register_batch(&1, &sample_batch(&env, "cocoa", "Grade A", 1_000));
    client.register_batch(&2, &sample_batch(&env, "cocoa", "Grade A", 1_000));
    client.mint(&holder, &1, &400);

    client.merge_batches(&1, &2, &400, &holder);

    assert_eq!(client.balance_of(&holder, &1), 0);
    assert_eq!(client.balance_of(&holder, &2), 400);
}

#[test]
#[should_panic]
fn merge_incompatible_batches_reverts() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env);
    let holder = Address::generate(&env);

    client.register_batch(&1, &sample_batch(&env, "cocoa", "Grade A", 1_000));
    client.register_batch(&2, &sample_batch(&env, "coffee", "Grade A", 1_000));
    client.mint(&holder, &1, &400);
    client.merge_batches(&1, &2, &400, &holder);
}

#[test]
fn expire_batch_sets_status() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env);

    client.register_batch(&1, &sample_batch(&env, "cocoa", "Grade A", 1_000));
    assert!(!client.is_expired(&1));

    client.expire_batch(&1);
    assert!(client.is_expired(&1));
}

#[test]
fn mint_batch_multiple_ids() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env);
    let holder = Address::generate(&env);

    client.register_batch(&1, &sample_batch(&env, "cocoa", "Grade A", 1_000));
    client.register_batch(&2, &sample_batch(&env, "coffee", "Grade A", 1_000));
    client.mint_batch(&holder, &vec![&env, 1, 2], &vec![&env, 100, 200]);

    assert_eq!(client.balance_of(&holder, &1), 100);
    assert_eq!(client.balance_of(&holder, &2), 200);
    assert_eq!(client.active_batch_count(), 2);
}
