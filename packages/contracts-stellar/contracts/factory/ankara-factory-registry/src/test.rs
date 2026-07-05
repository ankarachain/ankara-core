#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Bytes, BytesN, Env, String};

use token_factory::{FarmlandMetadata as FactoryFarmlandMetadata, Template, TokenFactory, TokenFactoryClient};

use crate::contract::{AnkaraFactoryRegistry, AnkaraFactoryRegistryClient, FactoryType};

const FARMLAND_WASM: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../target/wasm32v1-none/release/farmland_token.wasm"
));

fn deploy_token_factory<'a>(
    env: &'a Env,
    owner: &Address,
    fee_recipient: &Address,
) -> TokenFactoryClient<'a> {
    let contract_id = env.register(TokenFactory, ());
    let client = TokenFactoryClient::new(env, &contract_id);
    client.initialize(owner, fee_recipient);
    client.register_template(&Template::Farmland, &Bytes::from_slice(env, FARMLAND_WASM));
    client
}

#[test]
fn get_factory_returns_none_when_unregistered() {
    let env = Env::default();
    env.mock_all_auths();
    let owner = Address::generate(&env);
    let contract_id = env.register(AnkaraFactoryRegistry, ());
    let registry = AnkaraFactoryRegistryClient::new(&env, &contract_id);
    registry.initialize(&owner);

    assert_eq!(registry.get_factory(&FactoryType::Erc20), None);
    let deployer = Address::generate(&env);
    assert_eq!(registry.get_all_deployed_by_address(&deployer).len(), 0);
}

#[test]
fn aggregates_deployments_across_registered_factory() {
    let env = Env::default();
    env.mock_all_auths();
    let owner = Address::generate(&env);
    let fee_recipient = Address::generate(&env);

    let token_factory = deploy_token_factory(&env, &owner, &fee_recipient);

    let contract_id = env.register(AnkaraFactoryRegistry, ());
    let registry = AnkaraFactoryRegistryClient::new(&env, &contract_id);
    registry.initialize(&owner);
    registry.set_factory(&FactoryType::Erc20, &Some(token_factory.address.clone()));

    assert_eq!(
        registry.get_factory(&FactoryType::Erc20),
        Some(token_factory.address.clone())
    );

    let deployer = Address::generate(&env);
    let admin = Address::generate(&env);
    let native_token = Address::generate(&env);
    let asset_id = BytesN::from_array(&env, &[60u8; 32]);

    let token_address = token_factory.deploy_farmland_token(
        &deployer,
        &native_token,
        &asset_id,
        &String::from_str(&env, "Farm"),
        &String::from_str(&env, "FRM"),
        &asset_id,
        &String::from_str(&env, "NG"),
        &admin,
        &None,
        &FactoryFarmlandMetadata {
            location: String::from_str(&env, "n/a"),
            area_sq_meters: 0,
            soil_type: String::from_str(&env, "n/a"),
            irrigation_type: String::from_str(&env, "n/a"),
            crop_history: String::from_str(&env, "n/a"),
            title_document_hash: BytesN::from_array(&env, &[0u8; 32]),
            valuation_usd: 0,
            state_region: String::from_str(&env, "n/a"),
            last_updated: 0,
        },
    );

    let deployed = registry.get_all_deployed_by_address(&deployer);
    assert_eq!(deployed.len(), 1);
    assert_eq!(deployed.get(0).unwrap(), token_address);

    assert!(registry.is_ankara_token(&token_address));
    let stranger = Address::generate(&env);
    assert!(!registry.is_ankara_token(&stranger));
}
