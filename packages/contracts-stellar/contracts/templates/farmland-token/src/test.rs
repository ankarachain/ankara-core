#![cfg(test)]

use ankara_common::{AssetStatus, IdentityVerifierInterface};
use soroban_sdk::{contract, contractimpl, testutils::Address as _, Address, BytesN, Env, String};

use crate::contract::{FarmlandToken, FarmlandTokenClient};
use crate::metadata::FarmlandMetadata;

fn sample_metadata(env: &Env) -> FarmlandMetadata {
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

fn setup(env: &Env) -> (Address, FarmlandTokenClient<'_>, Address) {
    let admin = Address::generate(env);
    let contract_id = env.register(FarmlandToken, ());
    let client = FarmlandTokenClient::new(env, &contract_id);
    let asset_id = BytesN::from_array(env, &[9u8; 32]);
    client.initialize(
        &String::from_str(env, "Kaduna Farmland"),
        &String::from_str(env, "KDF"),
        &asset_id,
        &String::from_str(env, "NG"),
        &admin,
        &None,
        &None,
        &sample_metadata(env),
    );
    (admin, client, contract_id)
}

#[test]
fn initialize_sets_defaults() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client, _) = setup(&env);

    assert_eq!(client.status(), AssetStatus::Draft);
    assert_eq!(client.metadata_version(), 1);
    assert_eq!(client.symbol(), String::from_str(&env, "KDF"));
    assert_eq!(client.decimals(), 18);
}

#[test]
fn mint_and_transfer() {
    let env = Env::default();
    env.mock_all_auths();
    let (admin, client, _) = setup(&env);
    let holder = Address::generate(&env);
    let recipient = Address::generate(&env);

    client.mint(&holder, &1_000);
    assert_eq!(client.balance(&holder), 1_000);

    client.transfer(&holder, &recipient, &400);
    assert_eq!(client.balance(&holder), 600);
    assert_eq!(client.balance(&recipient), 400);

    let _ = admin;
}

#[test]
#[should_panic]
fn mint_requires_minter_role() {
    let env = Env::default();
    // deliberately do not mock_all_auths, so require_auth() fails for a
    // non-authorizing caller
    let (_, client, _) = setup(&env);
    let holder = Address::generate(&env);
    client.mint(&holder, &1_000);
}

#[test]
fn update_metadata_bumps_version_and_emits_valuation_event() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client, _) = setup(&env);

    let mut updated = sample_metadata(&env);
    updated.valuation_usd = 75_000_0000000_i128;
    client.update_metadata(&updated);

    assert_eq!(client.metadata_version(), 2);
    assert_eq!(client.valuation_usd(), 75_000_0000000_i128);
}

#[test]
fn update_valuation_and_title_document() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client, _) = setup(&env);

    client.update_valuation(&99_000_0000000_i128);
    assert_eq!(client.valuation_usd(), 99_000_0000000_i128);
    assert_eq!(client.metadata_version(), 2);

    let new_hash = BytesN::from_array(&env, &[2u8; 32]);
    client.update_title_document(&new_hash);
    assert_eq!(client.title_document_hash(), new_hash);
    assert_eq!(client.metadata_version(), 3);
}

#[test]
fn set_status_updates_lifecycle() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client, _) = setup(&env);

    client.set_status(&AssetStatus::Active);
    assert_eq!(client.status(), AssetStatus::Active);
}

#[test]
fn link_to_nft_stores_address() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client, _) = setup(&env);
    let nft = Address::generate(&env);

    client.link_to_nft(&nft);
    assert_eq!(client.linked_nft(), Some(nft));
}

// ─── Identity-verifier round trip ───────────────────────────────────────

#[contract]
struct RejectAllVerifier;

#[contractimpl]
impl IdentityVerifierInterface for RejectAllVerifier {
    fn is_verified(_env: Env, _account: Address) -> bool {
        false
    }
}

#[test]
#[should_panic]
fn mint_reverts_when_verifier_rejects() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client, _) = setup(&env);

    let verifier_id = env.register(RejectAllVerifier, ());
    client.set_identity_verifier(&Some(verifier_id));

    let holder = Address::generate(&env);
    client.mint(&holder, &1_000);
}

#[test]
fn mint_succeeds_when_no_verifier_configured() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client, _) = setup(&env);
    assert_eq!(client.identity_verifier(), None);

    let holder = Address::generate(&env);
    client.mint(&holder, &500);
    assert_eq!(client.balance(&holder), 500);
}

#[test]
fn snapshots_capture_historical_balances_and_supply() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client, _) = setup(&env);
    let a = Address::generate(&env);
    let b = Address::generate(&env);

    client.mint(&a, &100);
    assert_eq!(client.current_snapshot_id(), 0);
    assert!(client.try_balance_of_at(&a, &1).is_err());

    let s1 = client.snapshot();
    assert_eq!(s1, 1);
    client.transfer(&a, &b, &40);
    client.mint(&b, &10);

    let s2 = client.snapshot();
    client.transfer(&b, &a, &50);
    client.burn(&a, &20);

    // Snapshot 1: before any of the post-snapshot changes.
    assert_eq!(client.balance_of_at(&a, &s1), 100);
    assert_eq!(client.balance_of_at(&b, &s1), 0);
    assert_eq!(client.total_supply_at(&s1), 100);
    // Snapshot 2.
    assert_eq!(client.balance_of_at(&a, &s2), 60);
    assert_eq!(client.balance_of_at(&b, &s2), 50);
    assert_eq!(client.total_supply_at(&s2), 110);
    // Live.
    assert_eq!(client.balance(&a), 90);
    assert_eq!(client.balance(&b), 0);
    assert_eq!(client.total_supply(), 90);

    // An account untouched since snapshot 2 reads its live balance.
    let s3 = client.snapshot();
    assert_eq!(client.balance_of_at(&a, &s3), 90);
    assert!(client.try_total_supply_at(&4).is_err());
}

#[test]
#[should_panic]
fn snapshot_requires_manager() {
    let env = Env::default();
    let (_, client, _) = setup(&env);
    client.snapshot();
}
