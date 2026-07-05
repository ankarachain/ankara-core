#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Bytes, BytesN, Env};

use ramp_settlement::RampSettlementClient;

use crate::contract::{RampSettlementFactory, RampSettlementFactoryClient};

const RAMP_SETTLEMENT_WASM: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../target/wasm32v1-none/release/ramp_settlement.wasm"
));

#[test]
fn deploy_ramp_settlement() {
    let env = Env::default();
    env.mock_all_auths();

    let owner = Address::generate(&env);
    let fee_recipient = Address::generate(&env);
    let contract_id = env.register(RampSettlementFactory, ());
    let factory = RampSettlementFactoryClient::new(&env, &contract_id);
    factory.initialize(&owner, &fee_recipient);
    factory.set_implementation(&Bytes::from_slice(&env, RAMP_SETTLEMENT_WASM));

    let deployer = Address::generate(&env);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let native_token = Address::generate(&env);
    let salt = BytesN::from_array(&env, &[50u8; 32]);

    let address = factory.deploy_ramp_settlement(&deployer, &native_token, &salt, &admin, &treasury);

    assert_eq!(factory.total_deployed(), 1);
    let settlement = RampSettlementClient::new(&env, &address);
    assert_eq!(settlement.treasury(), treasury);
}
