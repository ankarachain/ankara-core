#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, String};

use crate::contract::{CarbonCreditToken, CarbonCreditTokenClient};
use crate::metadata::CarbonCreditMetadata;

fn sample_metadata(env: &Env) -> CarbonCreditMetadata {
    CarbonCreditMetadata {
        credit_type: String::from_str(env, "REDD+"),
        verification_body_ref: String::from_str(env, "VCS-1234"),
        vintage_year: 2025,
        quantity_co2e: 5_000,
        project_location: String::from_str(env, "Cross River, Nigeria"),
        project_type: String::from_str(env, "Forestry"),
        verification_doc_hash: BytesN::from_array(env, &[10u8; 32]),
        last_updated: 0,
    }
}

fn setup(env: &Env) -> (Address, CarbonCreditTokenClient<'_>) {
    let admin = Address::generate(env);
    let contract_id = env.register(CarbonCreditToken, ());
    let client = CarbonCreditTokenClient::new(env, &contract_id);
    client.initialize(
        &String::from_str(env, "Cross River REDD+"),
        &String::from_str(env, "CRC"),
        &BytesN::from_array(env, &[11u8; 32]),
        &String::from_str(env, "NG"),
        &admin,
        &None,
        &None,
        &sample_metadata(env),
    );
    (admin, client)
}

#[test]
fn retire_burns_and_records() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env);
    let holder = Address::generate(&env);

    client.mint(&holder, &1_000);
    client.retire(
        &holder,
        &400,
        &String::from_str(&env, "Acme Corp"),
        &String::from_str(&env, "2026 offset"),
    );

    assert_eq!(client.balance(&holder), 600);
    assert_eq!(client.total_retired(), 400);
    assert_eq!(client.total_retirements(), 1);

    let record = client.get_retirement(&0);
    assert_eq!(record.retired_by, holder);
    assert_eq!(record.amount, 400);
}

#[test]
#[should_panic]
fn retire_reverts_on_insufficient_balance() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env);
    let holder = Address::generate(&env);

    client.mint(&holder, &100);
    client.retire(
        &holder,
        &400,
        &String::from_str(&env, "Acme Corp"),
        &String::from_str(&env, "2026 offset"),
    );
}

#[test]
#[should_panic]
fn retire_reverts_on_zero_amount() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env);
    let holder = Address::generate(&env);

    client.mint(&holder, &100);
    client.retire(
        &holder,
        &0,
        &String::from_str(&env, "Acme Corp"),
        &String::from_str(&env, "2026 offset"),
    );
}
