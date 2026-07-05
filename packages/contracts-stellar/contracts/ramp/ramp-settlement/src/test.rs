#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, String};

use farmland_token::{FarmlandMetadata, FarmlandToken, FarmlandTokenClient};

use crate::contract::{RampSettlement, RampSettlementClient};
use crate::records::SettlementStatus;

fn deploy_token<'a>(env: &'a Env, admin: &Address) -> FarmlandTokenClient<'a> {
    let contract_id = env.register(FarmlandToken, ());
    let client = FarmlandTokenClient::new(env, &contract_id);
    client.initialize(
        &String::from_str(env, "Stablecoin"),
        &String::from_str(env, "USDX"),
        &BytesN::from_array(env, &[1u8; 32]),
        &String::from_str(env, "NG"),
        admin,
        &None,
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

fn setup(env: &Env) -> (Address, Address, RampSettlementClient<'_>) {
    let admin = Address::generate(env);
    let treasury = Address::generate(env);
    let contract_id = env.register(RampSettlement, ());
    let client = RampSettlementClient::new(env, &contract_id);
    client.initialize(&admin, &treasury);
    (admin, treasury, client)
}

#[test]
fn off_ramp_confirm_settles_to_treasury() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let (admin, treasury, settlement) = setup(&env);
    let token = deploy_token(&env, &admin);

    let depositor = Address::generate(&env);
    token.mint(&depositor, &1_000);
    let reference_id = BytesN::from_array(&env, &[7u8; 32]);

    settlement.initiate_off_ramp(
        &depositor,
        &reference_id,
        &token.address,
        &500,
        &String::from_str(&env, "provider-session-1"),
    );
    assert_eq!(token.balance(&depositor), 500);
    assert_eq!(
        settlement.get_off_ramp(&reference_id).unwrap().status,
        SettlementStatus::Pending
    );

    settlement.confirm_off_ramp_settlement(&reference_id);
    assert_eq!(token.balance(&treasury), 500);
    assert_eq!(
        settlement.get_off_ramp(&reference_id).unwrap().status,
        SettlementStatus::Settled
    );
}

#[test]
fn off_ramp_refund_returns_to_depositor() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let (admin, _, settlement) = setup(&env);
    let token = deploy_token(&env, &admin);

    let depositor = Address::generate(&env);
    token.mint(&depositor, &1_000);
    let reference_id = BytesN::from_array(&env, &[8u8; 32]);

    settlement.initiate_off_ramp(
        &depositor,
        &reference_id,
        &token.address,
        &500,
        &String::from_str(&env, "provider-session-2"),
    );
    settlement.refund_off_ramp(&reference_id);

    assert_eq!(token.balance(&depositor), 1_000);
    assert_eq!(
        settlement.get_off_ramp(&reference_id).unwrap().status,
        SettlementStatus::Refunded
    );
}

#[test]
#[should_panic]
fn off_ramp_reference_cannot_be_reused() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let (admin, _, settlement) = setup(&env);
    let token = deploy_token(&env, &admin);

    let depositor = Address::generate(&env);
    token.mint(&depositor, &1_000);
    let reference_id = BytesN::from_array(&env, &[9u8; 32]);

    settlement.initiate_off_ramp(
        &depositor,
        &reference_id,
        &token.address,
        &200,
        &String::from_str(&env, "s1"),
    );
    settlement.initiate_off_ramp(
        &depositor,
        &reference_id,
        &token.address,
        &200,
        &String::from_str(&env, "s2"),
    );
}

#[test]
fn on_ramp_records_attestation_without_moving_funds() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let (admin, _, settlement) = setup(&env);
    let token = deploy_token(&env, &admin);
    let recipient = Address::generate(&env);
    let reference_id = BytesN::from_array(&env, &[10u8; 32]);

    settlement.record_on_ramp_settlement(
        &reference_id,
        &recipient,
        &token.address,
        &750,
        &String::from_str(&env, "provider-onramp-1"),
    );

    let record = settlement.get_on_ramp(&reference_id).unwrap();
    assert_eq!(record.status, SettlementStatus::Recorded);
    assert_eq!(record.amount, 750);
    assert_eq!(token.balance(&recipient), 0); // attestation only, no mint/transfer
}
