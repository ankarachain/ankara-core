#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Bytes, BytesN, Env, String};

use farmland_nft::{FarmlandNFTClient, FarmlandNFTMetadata};

use crate::contract::{NFTFactory, NFTFactoryClient, Template};

const FARMLAND_NFT_WASM: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../target/wasm32v1-none/release/farmland_nft.wasm"
));

fn setup(env: &Env) -> (Address, Address, NFTFactoryClient<'_>) {
    let owner = Address::generate(env);
    let fee_recipient = Address::generate(env);
    let contract_id = env.register(NFTFactory, ());
    let client = NFTFactoryClient::new(env, &contract_id);
    client.initialize(&owner, &fee_recipient);
    (owner, fee_recipient, client)
}

#[test]
fn register_and_deploy_farmland_nft() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, _, factory) = setup(&env);
    factory.register_template(&Template::Farmland, &Bytes::from_slice(&env, FARMLAND_NFT_WASM));

    let deployer = Address::generate(&env);
    let admin = Address::generate(&env);
    let native_token = Address::generate(&env);
    let asset_id = BytesN::from_array(&env, &[20u8; 32]);

    let nft_address = factory.deploy_farmland_nft(
        &deployer,
        &native_token,
        &asset_id,
        &asset_id,
        &String::from_str(&env, "NG"),
        &admin,
        &None,
    );

    assert_eq!(factory.total_deployed(), 1);
    assert_eq!(
        factory.get_deployer_nfts(&deployer),
        soroban_sdk::vec![&env, nft_address.clone()]
    );

    let nft = FarmlandNFTClient::new(&env, &nft_address);
    let holder = Address::generate(&env);
    let token_id = nft.mint(
        &holder,
        &FarmlandNFTMetadata {
            location: String::from_str(&env, "6.5,3.3"),
            area_sq_meters: 1_000,
            soil_type: String::from_str(&env, "loam"),
            irrigation_type: String::from_str(&env, "rain-fed"),
            crop_history: String::from_str(&env, "maize"),
            title_document_hash: BytesN::from_array(&env, &[1u8; 32]),
            survey_report_hash: BytesN::from_array(&env, &[2u8; 32]),
            state_region: String::from_str(&env, "Kaduna"),
            last_updated: 0,
        },
    );
    assert_eq!(nft.owner_of(&token_id), holder);
}

#[test]
#[should_panic]
fn deploy_reverts_when_template_not_registered() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, _, factory) = setup(&env);

    let deployer = Address::generate(&env);
    let admin = Address::generate(&env);
    let native_token = Address::generate(&env);
    let asset_id = BytesN::from_array(&env, &[21u8; 32]);

    factory.deploy_farmland_nft(
        &deployer,
        &native_token,
        &asset_id,
        &asset_id,
        &String::from_str(&env, "NG"),
        &admin,
        &None,
    );
}
