#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, String};

use farmland_token::{FarmlandMetadata, FarmlandToken, FarmlandTokenClient};

use crate::contract::{CompliancePolicy, CompliancePolicyClient};

fn s(env: &Env, v: &str) -> String {
    String::from_str(env, v)
}

fn deploy_token<'a>(env: &'a Env, admin: &Address) -> FarmlandTokenClient<'a> {
    let id = env.register(FarmlandToken, ());
    let client = FarmlandTokenClient::new(env, &id);
    client.initialize(
        &s(env, "Farm"),
        &s(env, "FARM"),
        &BytesN::from_array(env, &[1u8; 32]),
        &s(env, "NG"),
        admin,
        &None,
        &None,
        &FarmlandMetadata {
            location: s(env, "n/a"),
            area_sq_meters: 0,
            soil_type: s(env, "n/a"),
            irrigation_type: s(env, "n/a"),
            crop_history: s(env, "n/a"),
            title_document_hash: BytesN::from_array(env, &[0u8; 32]),
            valuation_usd: 0,
            state_region: s(env, "n/a"),
            last_updated: 0,
        },
    );
    client
}

struct Setup<'a> {
    admin: Address,
    alice: Address,
    bob: Address,
    token: FarmlandTokenClient<'a>,
    policy: CompliancePolicyClient<'a>,
}

fn setup(env: &Env, attach: bool) -> Setup<'_> {
    let admin = Address::generate(env);
    let alice = Address::generate(env);
    let bob = Address::generate(env);
    let token = deploy_token(env, &admin);
    let policy_id = env.register(CompliancePolicy, ());
    let policy = CompliancePolicyClient::new(env, &policy_id);
    policy.initialize(&admin);
    if attach {
        token.set_compliance_policy(&Some(policy_id.clone()));
    }
    token.mint(&alice, &1_000);
    Setup { admin, alice, bob, token, policy }
}

// ─── Policy absent ────────────────────────────────────────────────────────

#[test]
fn without_policy_token_behaves_as_before() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env, false);
    assert!(t.token.compliance_policy().is_none());
    // A freeze on an unattached policy has no effect on the token.
    t.policy.freeze(&t.alice, &s(&env, "case-1"));
    t.token.transfer(&t.alice, &t.bob, &100);
    assert_eq!(t.token.balance(&t.bob), 100);
}

#[test]
fn clawback_impossible_without_policy() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env, false);
    assert!(t
        .policy
        .try_clawback(&t.token.address, &t.alice, &100, &None)
        .is_err());
    assert!(t.token.try_clawback(&t.alice, &100, &None).is_err());
    assert_eq!(t.token.balance(&t.alice), 1_000);
}

// ─── Policy attached ──────────────────────────────────────────────────────

#[test]
fn frozen_account_cannot_send_receive_or_burn() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env, true);
    t.policy.freeze(&t.alice, &s(&env, "court-order-42"));
    assert!(t.policy.is_frozen(&t.alice));
    assert_eq!(t.policy.freeze_record(&t.alice).unwrap().reason, s(&env, "court-order-42"));

    assert!(t.token.try_transfer(&t.alice, &t.bob, &10).is_err());
    assert!(t.token.try_burn(&t.alice, &10).is_err());
    // Incoming transfers and mints to a frozen account are rejected too.
    t.token.mint(&t.bob, &50);
    assert!(t.token.try_transfer(&t.bob, &t.alice, &10).is_err());
    assert!(t.token.try_mint(&t.alice, &10).is_err());

    t.policy.unfreeze(&t.alice);
    t.token.transfer(&t.alice, &t.bob, &10);
    assert_eq!(t.token.balance(&t.bob), 60);
}

#[test]
fn transfer_from_is_checked_too() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env, true);
    let spender = Address::generate(&env);
    t.token.approve(&t.alice, &spender, &500, &1_000);
    t.policy.freeze(&t.bob, &s(&env, "sanctions"));
    assert!(t.token.try_transfer_from(&spender, &t.alice, &t.bob, &10).is_err());
}

#[test]
fn per_transfer_cap_applies_to_transfers_only() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env, true);
    t.policy.set_max_transfer_amount(&100);
    assert!(t.token.try_transfer(&t.alice, &t.bob, &101).is_err());
    t.token.transfer(&t.alice, &t.bob, &100);
    // Mints above the cap are still fine.
    t.token.mint(&t.bob, &10_000);
    t.policy.set_max_transfer_amount(&0);
    t.token.transfer(&t.alice, &t.bob, &500);
    assert_eq!(t.token.balance(&t.bob), 10_600);
}

#[test]
fn clawback_burn_and_redirect_even_when_frozen() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env, true);
    t.policy.freeze(&t.alice, &s(&env, "fraud"));

    // Burn 300.
    t.policy.clawback(&t.token.address, &t.alice, &300, &None);
    assert_eq!(t.token.balance(&t.alice), 700);
    assert_eq!(t.token.total_supply(), 700);

    // Move 200 to a recovery address — supply unchanged.
    let recovery = Address::generate(&env);
    t.policy.clawback(&t.token.address, &t.alice, &200, &Some(recovery.clone()));
    assert_eq!(t.token.balance(&t.alice), 500);
    assert_eq!(t.token.balance(&recovery), 200);
    assert_eq!(t.token.total_supply(), 700);
}

#[test]
fn clawback_cannot_exceed_balance() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env, true);
    assert!(t
        .policy
        .try_clawback(&t.token.address, &t.alice, &1_001, &None)
        .is_err());
}

#[test]
fn only_policy_contract_can_call_token_clawback() {
    let env = Env::default();
    let t = {
        env.mock_all_auths();
        setup(&env, true)
    };
    // Without mocked auths, a direct call to the token's clawback needs the
    // policy contract's authorization, which an external caller can't give.
    env.set_auths(&[]);
    assert!(t.token.try_clawback(&t.alice, &100, &None).is_err());
    assert_eq!(t.token.balance(&t.alice), 1_000);
    let _ = t.admin;
}

#[test]
#[should_panic]
fn freeze_requires_admin() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let id = env.register(CompliancePolicy, ());
    let policy = CompliancePolicyClient::new(&env, &id);
    policy.initialize(&admin);
    policy.freeze(&Address::generate(&env), &s(&env, "x"));
}

#[test]
fn detaching_policy_restores_open_transfers() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env, true);
    t.policy.freeze(&t.alice, &s(&env, "x"));
    t.token.set_compliance_policy(&None);
    t.token.transfer(&t.alice, &t.bob, &1);
    assert_eq!(t.token.balance(&t.bob), 1);
}
