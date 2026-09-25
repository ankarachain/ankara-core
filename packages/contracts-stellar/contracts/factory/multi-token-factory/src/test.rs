#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Bytes, BytesN, Env, String};

use commodity_batch_token::CommodityBatchTokenClient;
use pool_vault::PoolVaultClient;

use crate::contract::{MultiTokenFactory, MultiTokenFactoryClient, Template};
use crate::metadata::WarehouseMetadata;

const COMMODITY_BATCH_WASM: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../target/wasm32v1-none/release/commodity_batch_token.wasm"
));
const POOL_VAULT_WASM: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../target/wasm32v1-none/release/pool_vault.wasm"
));

fn setup(env: &Env) -> (Address, Address, MultiTokenFactoryClient<'_>) {
    let owner = Address::generate(env);
    let fee_recipient = Address::generate(env);
    let contract_id = env.register(MultiTokenFactory, ());
    let client = MultiTokenFactoryClient::new(env, &contract_id);
    client.initialize(&owner, &fee_recipient);
    (owner, fee_recipient, client)
}

#[test]
fn deploy_commodity_batch_token() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, _, factory) = setup(&env);
    factory.register_template(
        &Template::CommodityBatch,
        &Bytes::from_slice(&env, COMMODITY_BATCH_WASM),
    );

    let deployer = Address::generate(&env);
    let admin = Address::generate(&env);
    let operator = Address::generate(&env);
    let native_token = Address::generate(&env);
    let salt = BytesN::from_array(&env, &[30u8; 32]);

    let address = factory.deploy_commodity_batch_token(
        &deployer,
        &native_token,
        &salt,
        &String::from_str(&env, "Tema Warehouse"),
        &String::from_str(&env, "GH"),
        &String::from_str(&env, "https://example.com/"),
        &admin,
        &WarehouseMetadata {
            warehouse_id: String::from_str(&env, "WH-01"),
            warehouse_location: String::from_str(&env, "Tema Port"),
            operator_address: operator,
            warehouse_license_hash: BytesN::from_array(&env, &[1u8; 32]),
            certification_expiry: 999_999_999,
        },
    );

    assert_eq!(factory.total_deployed(), 1);
    let batch_token = CommodityBatchTokenClient::new(&env, &address);
    assert_eq!(
        batch_token.contract_name(),
        String::from_str(&env, "Tema Warehouse")
    );
}

#[test]
fn deploy_pool_vault() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, _, factory) = setup(&env);
    factory.register_template(&Template::PoolVault, &Bytes::from_slice(&env, POOL_VAULT_WASM));

    let deployer = Address::generate(&env);
    let admin = Address::generate(&env);
    let native_token = Address::generate(&env);
    let salt = BytesN::from_array(&env, &[31u8; 32]);
    let asset_id = BytesN::from_array(&env, &[32u8; 32]);

    let address = factory.deploy_pool_vault(
        &deployer,
        &native_token,
        &salt,
        &String::from_str(&env, "Ankara Commodity Basket"),
        &String::from_str(&env, "ACB"),
        &asset_id,
        &String::from_str(&env, "NG"),
        &admin,
        &None,
        &None,
        &0,
    );

    assert_eq!(factory.total_deployed(), 1);
    let vault = PoolVaultClient::new(&env, &address);
    assert_eq!(vault.symbol(), String::from_str(&env, "ACB"));
    assert_eq!(vault.management_fee_bps(), 50);
}

#[test]
fn deploy_governed_pool_vault() {
    use ankara_common::governance::GovernanceConfig;
    let env = Env::default();
    env.mock_all_auths();
    let (_, _, factory) = setup(&env);
    factory.register_template(&Template::PoolVault, &Bytes::from_slice(&env, POOL_VAULT_WASM));
    let cfg = GovernanceConfig {
        voting_period: 3 * 86_400,
        timelock: 86_400,
        quorum_bps: 2_000,
        proposal_threshold_bps: 100,
    };
    let address = factory.deploy_governed_pool_vault(
        &Address::generate(&env),
        &Address::generate(&env),
        &BytesN::from_array(&env, &[41u8; 32]),
        &String::from_str(&env, "Kaduna Farmers Coop Fund"),
        &String::from_str(&env, "KFCF"),
        &BytesN::from_array(&env, &[42u8; 32]),
        &String::from_str(&env, "NG"),
        &Address::generate(&env),
        &None,
        &None,
        &0,
        &cfg,
    );
    let vault = PoolVaultClient::new(&env, &address);
    assert_eq!(vault.governance_config(), Some(cfg));
    assert!(vault.try_set_management_fee_bps(&1).is_err());
    assert_eq!(factory.total_deployed(), 1);
}
