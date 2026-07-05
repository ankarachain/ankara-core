#![cfg(test)]

use ankara_common::AssetStatus;
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, String};

use crate::contract::{RealEstateToken, RealEstateTokenClient};
use crate::metadata::RealEstateMetadata;

fn sample_metadata(env: &Env, developer: &Address) -> RealEstateMetadata {
    RealEstateMetadata {
        property_id: String::from_str(env, "LR-2024-001"),
        property_type: String::from_str(env, "Residential"),
        location_address: String::from_str(env, "Lekki Phase 1, Lagos"),
        total_area_sq_meters: 450,
        title_document_hash: BytesN::from_array(env, &[4u8; 32]),
        valuation_usd: 250_000_0000000_i128,
        rental_yield_bps: 600,
        occupancy_status: String::from_str(env, "Tenanted"),
        developer_address: developer.clone(),
        last_updated: 0,
    }
}

fn setup(env: &Env) -> (Address, RealEstateTokenClient<'_>) {
    let admin = Address::generate(env);
    let developer = Address::generate(env);
    let contract_id = env.register(RealEstateToken, ());
    let client = RealEstateTokenClient::new(env, &contract_id);
    client.initialize(
        &String::from_str(env, "Lekki Residence"),
        &String::from_str(env, "LKR"),
        &BytesN::from_array(env, &[8u8; 32]),
        &String::from_str(env, "NG"),
        &admin,
        &None,
        &None,
        &sample_metadata(env, &developer),
    );
    (admin, client)
}

#[test]
fn initialize_and_read_metadata() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env);

    assert_eq!(client.status(), AssetStatus::Draft);
    assert_eq!(client.rental_yield_bps(), 600);
    assert_eq!(client.occupancy_status(), String::from_str(&env, "Tenanted"));
}

#[test]
fn update_occupancy_status() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env);

    client.update_occupancy_status(&String::from_str(&env, "Vacant"));
    assert_eq!(client.occupancy_status(), String::from_str(&env, "Vacant"));
    assert_eq!(client.metadata_version(), 2);
}

#[test]
fn declare_rental_distribution_splits_per_token() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env);
    let holder = Address::generate(&env);

    client.mint(&holder, &1_000);
    client.declare_rental_distribution(&10_000);

    assert_eq!(client.total_rental_distributed(), 10_000);
}

#[test]
#[should_panic]
fn declare_rental_distribution_requires_supply() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env);

    client.declare_rental_distribution(&10_000);
}
