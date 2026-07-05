#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Bytes, BytesN, Env, String};

// The dev-dependency template crates are used here only to build typed
// clients for asserting on the *deployed* contracts' behavior — the
// metadata passed *into* the factory calls below uses this crate's own
// local `metadata` module (the factory's actual public API type), not the
// template crates' identically-shaped-but-distinct Rust types.
use farmland_token::FarmlandTokenClient;

use crate::contract::{Template, TokenFactory, TokenFactoryClient};
use crate::metadata::{CommodityMetadata, FarmlandMetadata};

// Requires `cargo build --target wasm32v1-none --release --workspace` to
// have already run (the `test` npm script does this before `cargo test`) —
// the factory deploys real template WASM, so its tests need the compiled
// artifacts to exist on disk, unlike the template crates' own tests which
// run entirely against native (non-WASM) code via `soroban_sdk::testutils`.
const FARMLAND_WASM: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../target/wasm32v1-none/release/farmland_token.wasm"
));
const COMMODITY_WASM: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../target/wasm32v1-none/release/commodity_receipt_token.wasm"
));

fn sample_farmland_metadata(env: &Env) -> FarmlandMetadata {
    FarmlandMetadata {
        location: String::from_str(env, "6.5244,3.3792"),
        area_sq_meters: 12_000,
        soil_type: String::from_str(env, "loam"),
        irrigation_type: String::from_str(env, "borehole"),
        crop_history: String::from_str(env, "maize,sorghum,fallow"),
        title_document_hash: BytesN::from_array(env, &[1u8; 32]),
        valuation_usd: 50_000_0000000_i128,
        state_region: String::from_str(env, "Kaduna"),
        last_updated: 0,
    }
}

fn sample_commodity_metadata(env: &Env) -> CommodityMetadata {
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

fn setup(env: &Env) -> (Address, Address, TokenFactoryClient<'_>) {
    let owner = Address::generate(env);
    let fee_recipient = Address::generate(env);
    let contract_id = env.register(TokenFactory, ());
    let client = TokenFactoryClient::new(env, &contract_id);
    client.initialize(&owner, &fee_recipient);
    (owner, fee_recipient, client)
}

#[test]
fn register_template_and_deploy_farmland() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, _, factory) = setup(&env);
    let wasm = Bytes::from_slice(&env, FARMLAND_WASM);
    factory.register_template(&Template::Farmland, &wasm);

    let deployer = Address::generate(&env);
    let admin = Address::generate(&env);
    let native_token = Address::generate(&env); // fee is 0 by default, not touched
    let asset_id = BytesN::from_array(&env, &[9u8; 32]);

    let token_address = factory.deploy_farmland_token(
        &deployer,
        &native_token,
        &asset_id,
        &String::from_str(&env, "Kaduna Farmland"),
        &String::from_str(&env, "KDF"),
        &asset_id,
        &String::from_str(&env, "NG"),
        &admin,
        &None,
        &sample_farmland_metadata(&env),
    );

    assert_eq!(factory.total_deployed(), 1);
    assert_eq!(factory.get_deployer_tokens(&deployer), soroban_sdk::vec![&env, token_address.clone()]);

    let token = FarmlandTokenClient::new(&env, &token_address);
    assert_eq!(token.symbol(), String::from_str(&env, "KDF"));
    assert_eq!(token.valuation_usd(), 50_000_0000000_i128);
}

#[test]
fn deploy_two_different_templates_from_same_factory() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, _, factory) = setup(&env);
    factory.register_template(&Template::Farmland, &Bytes::from_slice(&env, FARMLAND_WASM));
    factory.register_template(
        &Template::CommodityReceipt,
        &Bytes::from_slice(&env, COMMODITY_WASM),
    );

    let deployer = Address::generate(&env);
    let admin = Address::generate(&env);
    let native_token = Address::generate(&env);

    let farmland_id = BytesN::from_array(&env, &[1u8; 32]);
    factory.deploy_farmland_token(
        &deployer,
        &native_token,
        &farmland_id,
        &String::from_str(&env, "Farm"),
        &String::from_str(&env, "FRM"),
        &farmland_id,
        &String::from_str(&env, "NG"),
        &admin,
        &None,
        &sample_farmland_metadata(&env),
    );

    let commodity_id = BytesN::from_array(&env, &[2u8; 32]);
    factory.deploy_commodity_receipt_token(
        &deployer,
        &native_token,
        &commodity_id,
        &String::from_str(&env, "Cocoa"),
        &String::from_str(&env, "COC"),
        &commodity_id,
        &String::from_str(&env, "GH"),
        &admin,
        &None,
        &sample_commodity_metadata(&env),
    );

    assert_eq!(factory.total_deployed(), 2);
    assert_eq!(factory.get_deployer_tokens(&deployer).len(), 2);
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
    let asset_id = BytesN::from_array(&env, &[9u8; 32]);

    factory.deploy_farmland_token(
        &deployer,
        &native_token,
        &asset_id,
        &String::from_str(&env, "Kaduna Farmland"),
        &String::from_str(&env, "KDF"),
        &asset_id,
        &String::from_str(&env, "NG"),
        &admin,
        &None,
        &sample_farmland_metadata(&env),
    );
}

#[test]
fn deployment_fee_is_collected_when_nonzero() {
    let env = Env::default();
    env.mock_all_auths();
    let (owner, fee_recipient, factory) = setup(&env);
    factory.register_template(&Template::Farmland, &Bytes::from_slice(&env, FARMLAND_WASM));
    factory.register_template(
        &Template::CommodityReceipt,
        &Bytes::from_slice(&env, COMMODITY_WASM),
    );

    // Use a deployed CommodityReceiptToken as the "payment token" — it
    // already implements the SEP-41 interface the factory's fee-collection
    // logic calls, so no separate mock token contract is needed.
    let deployer = Address::generate(&env);
    let admin = Address::generate(&env);
    let payment_asset_id = BytesN::from_array(&env, &[5u8; 32]);
    let payment_token_address = factory.deploy_commodity_receipt_token(
        &deployer,
        &Address::generate(&env),
        &payment_asset_id,
        &String::from_str(&env, "Payment Token"),
        &String::from_str(&env, "PAY"),
        &payment_asset_id,
        &String::from_str(&env, "NG"),
        &admin,
        &None,
        &sample_commodity_metadata(&env),
    );
    let payment_token = commodity_receipt_token::CommodityReceiptTokenClient::new(
        &env,
        &payment_token_address,
    );
    payment_token.mint(&deployer, &1_000);

    factory.set_deployment_fee(&100);
    assert_eq!(factory.deployment_fee(), 100);

    let farmland_id = BytesN::from_array(&env, &[6u8; 32]);
    factory.deploy_farmland_token(
        &deployer,
        &payment_token_address,
        &farmland_id,
        &String::from_str(&env, "Farm"),
        &String::from_str(&env, "FRM"),
        &farmland_id,
        &String::from_str(&env, "NG"),
        &admin,
        &None,
        &sample_farmland_metadata(&env),
    );

    assert_eq!(payment_token.balance(&deployer), 900);
    assert_eq!(payment_token.balance(&fee_recipient), 100);
}
