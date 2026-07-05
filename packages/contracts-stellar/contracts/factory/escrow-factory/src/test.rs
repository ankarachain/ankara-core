#![cfg(test)]

use soroban_sdk::{testutils::Address as _, vec, Address, Bytes, BytesN, Env, String};

use farmland_token::{FarmlandMetadata, FarmlandToken, FarmlandTokenClient};
use milestone_escrow::MilestoneEscrowClient;

use crate::contract::{EscrowFactory, EscrowFactoryClient};

const MILESTONE_ESCROW_WASM: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../target/wasm32v1-none/release/milestone_escrow.wasm"
));

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

#[test]
fn deploy_escrow_and_fund() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let owner = Address::generate(&env);
    let fee_recipient = Address::generate(&env);
    let contract_id = env.register(EscrowFactory, ());
    let factory = EscrowFactoryClient::new(&env, &contract_id);
    factory.initialize(&owner, &fee_recipient);
    factory.set_implementation(&Bytes::from_slice(&env, MILESTONE_ESCROW_WASM));

    let admin = Address::generate(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let token = deploy_token(&env, &admin);
    token.mint(&payer, &1_000);

    let deployer = Address::generate(&env);
    let salt = BytesN::from_array(&env, &[40u8; 32]);

    let escrow_address = factory.deploy_escrow(
        &deployer,
        &token.address,
        &salt,
        &admin,
        &payer,
        &payee,
        &None,
        &token.address,
        &None,
        &0,
        &vec![&env, 1_000i128],
        &vec![&env, BytesN::from_array(&env, &[1u8; 32])],
    );

    assert_eq!(factory.total_deployed(), 1);
    let escrow = MilestoneEscrowClient::new(&env, &escrow_address);
    escrow.fund(&payer);
    assert!(escrow.funded());
    assert_eq!(token.balance(&payer), 0);
}
