#![cfg(test)]

use ankara_common::AssetStatus;
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, String};

use crate::contract::{CommodityReceiptToken, CommodityReceiptTokenClient};
use crate::metadata::CommodityMetadata;

fn sample_metadata(env: &Env) -> CommodityMetadata {
    CommodityMetadata {
        commodity_type: String::from_str(env, "cocoa"),
        quantity_kg: 20_000,
        grade_classification: String::from_str(env, "Grade A"),
        warehouse_id: String::from_str(env, "WH-001"),
        warehouse_location: String::from_str(env, "Tema Port"),
        deposit_date: 1_000,
        expiry_date: 100_000,
        inspection_report_hash: BytesN::from_array(env, &[3u8; 32]),
        valuation_usd: 40_000_0000000_i128,
        harvest_season: String::from_str(env, "2025/2026"),
        last_updated: 0,
    }
}

fn setup(env: &Env) -> (Address, CommodityReceiptTokenClient<'_>) {
    let admin = Address::generate(env);
    let contract_id = env.register(CommodityReceiptToken, ());
    let client = CommodityReceiptTokenClient::new(env, &contract_id);
    client.initialize(
        &String::from_str(env, "Tema Cocoa Receipt"),
        &String::from_str(env, "TCR"),
        &BytesN::from_array(env, &[7u8; 32]),
        &String::from_str(env, "GH"),
        &admin,
        &None,
        &None,
        &sample_metadata(env),
    );
    (admin, client)
}

#[test]
fn initialize_and_read_metadata() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env);

    assert_eq!(client.status(), AssetStatus::Draft);
    assert_eq!(client.commodity_type(), String::from_str(&env, "cocoa"));
    assert_eq!(client.quantity_kg(), 20_000);
    assert!(!client.is_expired());
}

#[test]
fn mark_expired_sets_status() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env);

    client.mark_expired();
    assert_eq!(client.status(), AssetStatus::Expired);
}

#[test]
fn update_metadata_bumps_version() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env);

    let mut updated = sample_metadata(&env);
    updated.quantity_kg = 18_500;
    client.update_metadata(&updated);

    assert_eq!(client.quantity_kg(), 18_500);
    assert_eq!(client.metadata_version(), 2);
}

#[test]
fn mint_and_balance() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env);
    let holder = Address::generate(&env);

    client.mint(&holder, &2_000);
    assert_eq!(client.balance(&holder), 2_000);
}
