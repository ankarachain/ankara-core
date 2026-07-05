#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, BytesN, Env, String,
};

use farmland_token::{FarmlandMetadata, FarmlandToken, FarmlandTokenClient};
use manual_oracle::{ManualOracle, ManualOracleClient};

use crate::contract::{PoolVault, PoolVaultClient};

fn deploy_asset_token<'a>(env: &'a Env, admin: &Address) -> FarmlandTokenClient<'a> {
    let contract_id = env.register(FarmlandToken, ());
    let client = FarmlandTokenClient::new(env, &contract_id);
    client.initialize(
        &String::from_str(env, "Farmland Share"),
        &String::from_str(env, "FLS"),
        &BytesN::from_array(env, &[1u8; 32]),
        &String::from_str(env, "NG"),
        admin,
        &None,
        &None,
        &FarmlandMetadata {
            location: String::from_str(env, "6.5,3.3"),
            area_sq_meters: 1_000,
            soil_type: String::from_str(env, "loam"),
            irrigation_type: String::from_str(env, "rain-fed"),
            crop_history: String::from_str(env, "maize"),
            title_document_hash: BytesN::from_array(env, &[2u8; 32]),
            valuation_usd: 1_000,
            state_region: String::from_str(env, "Kaduna"),
            last_updated: 0,
        },
    );
    client
}

fn deploy_oracle<'a>(env: &'a Env, admin: &Address) -> ManualOracleClient<'a> {
    let contract_id = env.register(ManualOracle, ());
    let client = ManualOracleClient::new(env, &contract_id);
    client.initialize(admin, &86_400);
    client
}

fn setup(env: &Env) -> (Address, PoolVaultClient<'_>) {
    let admin = Address::generate(env);
    let contract_id = env.register(PoolVault, ());
    let client = PoolVaultClient::new(env, &contract_id);
    client.initialize(
        &String::from_str(env, "Ankara Commodity Basket"),
        &String::from_str(env, "ACB"),
        &BytesN::from_array(env, &[3u8; 32]),
        &String::from_str(env, "NG"),
        &admin,
        &None,
        &None,
        &None,
        &0,
    );
    (admin, client)
}

#[test]
fn add_accepted_token_and_set_oracle() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    env.ledger().with_mut(|l| l.timestamp = 1_700_000_000);
    let (admin, vault) = setup(&env);
    let asset_token = deploy_asset_token(&env, &admin);
    let oracle = deploy_oracle(&env, &admin);

    vault.add_accepted_token(&asset_token.address, &5_000);
    vault.set_oracle(&oracle.address);

    assert!(vault.is_accepted(&asset_token.address));
    assert_eq!(vault.management_fee_bps(), 50); // defaults to 50 bps when 0 passed at init
}

#[test]
fn deposit_bootstraps_nav_at_one_dollar() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    env.ledger().with_mut(|l| l.timestamp = 1_700_000_000);
    let (admin, vault) = setup(&env);
    let asset_token = deploy_asset_token(&env, &admin);
    let oracle = deploy_oracle(&env, &admin);

    vault.add_accepted_token(&asset_token.address, &10_000);
    vault.set_oracle(&oracle.address);
    oracle.set_price(&asset_token.address, &1_000_000_000_000_000_000_i128); // $1.00

    let investor = Address::generate(&env);
    asset_token.mint(&investor, &1_000);

    vault.deposit(&investor, &asset_token.address, &500);

    // Bootstrap: 500 units @ $1.00 = $500 -> 500 pool tokens minted 1:1
    assert_eq!(vault.balance(&investor), 500);
    assert_eq!(asset_token.balance(&investor), 500);
    assert_eq!(asset_token.balance(&vault.address), 500);
}

#[test]
fn withdraw_returns_proportional_basket() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    env.ledger().with_mut(|l| l.timestamp = 1_700_000_000);
    let (admin, vault) = setup(&env);
    let asset_token = deploy_asset_token(&env, &admin);
    let oracle = deploy_oracle(&env, &admin);

    vault.add_accepted_token(&asset_token.address, &10_000);
    vault.set_oracle(&oracle.address);
    oracle.set_price(&asset_token.address, &1_000_000_000_000_000_000_i128);

    let investor = Address::generate(&env);
    asset_token.mint(&investor, &1_000);
    vault.deposit(&investor, &asset_token.address, &500);

    vault.withdraw(&investor, &500);

    assert_eq!(vault.balance(&investor), 0);
    assert_eq!(asset_token.balance(&investor), 1_000);
}

#[test]
#[should_panic]
fn deposit_rejects_non_accepted_token() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    env.ledger().with_mut(|l| l.timestamp = 1_700_000_000);
    let (admin, vault) = setup(&env);
    let asset_token = deploy_asset_token(&env, &admin);

    let investor = Address::generate(&env);
    asset_token.mint(&investor, &1_000);
    vault.deposit(&investor, &asset_token.address, &500);
}

#[test]
fn accrue_management_fee_mints_to_fee_recipient() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    env.ledger().with_mut(|l| l.timestamp = 1_700_000_000);

    let admin = Address::generate(&env);
    let fee_recipient = Address::generate(&env);
    let contract_id = env.register(PoolVault, ());
    let vault = PoolVaultClient::new(&env, &contract_id);
    vault.initialize(
        &String::from_str(&env, "Ankara Commodity Basket"),
        &String::from_str(&env, "ACB"),
        &BytesN::from_array(&env, &[3u8; 32]),
        &String::from_str(&env, "NG"),
        &admin,
        &None,
        &Some(fee_recipient.clone()),
        &None,
        &1_000, // 10% annual fee, to make the effect observable quickly
    );

    let asset_token = deploy_asset_token(&env, &admin);
    let oracle = deploy_oracle(&env, &admin);
    vault.add_accepted_token(&asset_token.address, &10_000);
    vault.set_oracle(&oracle.address);
    oracle.set_price(&asset_token.address, &1_000_000_000_000_000_000_i128);

    let investor = Address::generate(&env);
    asset_token.mint(&investor, &1_000_000);
    vault.deposit(&investor, &asset_token.address, &1_000_000);

    env.ledger().with_mut(|l| l.timestamp += 365 * 24 * 60 * 60); // +1 year
    vault.accrue_management_fee();

    // 10% of 1_000_000 supply over 1 year ~= 100_000
    assert_eq!(vault.balance(&fee_recipient), 100_000);
}
