#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    vec, Address, BytesN, Env, String,
};

use farmland_token::{FarmlandMetadata, FarmlandToken, FarmlandTokenClient};

use crate::contract::{MilestoneEscrow, MilestoneEscrowClient};
use crate::deal::MilestoneStatus;

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

struct Setup<'a> {
    payer: Address,
    payee: Address,
    arbiter: Address,
    token: FarmlandTokenClient<'a>,
    escrow: MilestoneEscrowClient<'a>,
}

fn setup(env: &Env) -> Setup<'_> {
    let admin = Address::generate(env);
    let payer = Address::generate(env);
    let payee = Address::generate(env);
    let arbiter = Address::generate(env);

    let token = deploy_token(env, &admin);
    token.mint(&payer, &1_000);

    let contract_id = env.register(MilestoneEscrow, ());
    let escrow = MilestoneEscrowClient::new(env, &contract_id);
    escrow.initialize(
        &admin,
        &payer,
        &payee,
        &Some(arbiter.clone()),
        &token.address,
        &None,
        &0,
        &vec![env, 300, 700],
        &vec![
            env,
            BytesN::from_array(env, &[10u8; 32]),
            BytesN::from_array(env, &[11u8; 32]),
        ],
    );

    Setup {
        payer,
        payee,
        arbiter,
        token,
        escrow,
    }
}

#[test]
fn fund_transfers_only_the_funded_milestones_amount() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let s = setup(&env);

    assert_eq!(s.escrow.total_amount(), 1_000);
    s.escrow.fund(&s.payer, &0);

    // Only milestone 0's 300 has moved — the deal isn't "funded" as a whole
    // until every milestone is individually funded (installments).
    assert!(!s.escrow.funded());
    assert!(s.escrow.get_milestone(&0).funded);
    assert!(!s.escrow.get_milestone(&1).funded);
    assert_eq!(s.token.balance(&s.payer), 700);
    assert_eq!(s.escrow.remaining_balance(), 300);

    s.escrow.fund(&s.payer, &1);
    assert!(s.escrow.funded());
    assert_eq!(s.token.balance(&s.payer), 0);
    assert_eq!(s.escrow.remaining_balance(), 1_000);
}

#[test]
#[should_panic]
fn fund_rejects_funding_the_same_milestone_twice() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let s = setup(&env);

    s.escrow.fund(&s.payer, &0);
    s.escrow.fund(&s.payer, &0);
}

#[test]
fn fund_requires_root_level_payer_auth() {
    // Regression test: `fund` used to rely solely on the nested token
    // transfer's internal `from.require_auth()` rather than calling
    // `caller.require_auth()` itself at the top of the function. That passes
    // under `mock_all_auths_allowing_non_root_auth()` (used everywhere else
    // in this file) and under real signing when the source account happens
    // to equal the payer, but fails on live Soroban RPC in the general case
    // — non-root auth requirements aren't auto-satisfied by the invoking
    // account the way root-level ones are. Using plain `mock_all_auths()`
    // (root-only, no leniency) here reproduces that real-network failure
    // mode locally: this test would panic without the `caller.require_auth()`
    // line at the top of `fund`.
    let env = Env::default();
    env.mock_all_auths();
    let s = setup(&env);

    s.escrow.fund(&s.payer, &0);
    s.escrow.fund(&s.payer, &1);

    assert!(s.escrow.funded());
}

#[test]
fn approve_milestone_releases_to_payee() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let s = setup(&env);
    s.escrow.fund(&s.payer, &0);

    s.escrow.mark_delivered(&s.payee, &0);
    assert_eq!(s.escrow.get_milestone(&0).status, MilestoneStatus::Delivered);

    s.escrow.approve_milestone(&s.payer, &0);
    assert_eq!(s.escrow.get_milestone(&0).status, MilestoneStatus::Released);
    assert_eq!(s.token.balance(&s.payee), 300);
}

#[test]
fn mark_delivered_actually_requires_payee_auth() {
    // Regression test: mark_delivered/approve_milestone/raise_dispute/
    // resolve_dispute must call `caller.require_auth()`, not just compare
    // `caller` against the stored payee/payer/arbiter — otherwise anyone
    // could pass in that party's address without holding their key. Under
    // `mock_all_auths()` every `require_auth()` call succeeds regardless of
    // who's "really" signing, so the way to catch a *missing* auth check is
    // to inspect `env.auths()` afterwards and confirm the payee's address
    // actually appears as an authorizer for this invocation.
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let s = setup(&env);
    s.escrow.fund(&s.payer, &0);

    s.escrow.mark_delivered(&s.payee, &0);

    let authorized = env.auths().iter().any(|(addr, _)| *addr == s.payee);
    assert!(authorized, "mark_delivered did not require the payee's authorization");
}

#[test]
fn dispute_resolved_in_favor_of_payer_refunds() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let s = setup(&env);
    s.escrow.fund(&s.payer, &1); // milestone 0 (300) left unfunded on purpose

    s.escrow.mark_delivered(&s.payee, &1);
    s.escrow.raise_dispute(&s.payer, &1);
    assert_eq!(s.escrow.get_milestone(&1).status, MilestoneStatus::Disputed);

    s.escrow.resolve_dispute(&s.arbiter, &1, &false);
    assert_eq!(s.escrow.get_milestone(&1).status, MilestoneStatus::Refunded);
    assert_eq!(s.token.balance(&s.payer), 1_000); // milestone 1's 700 refunded; milestone 0 never left the payer
}

#[test]
fn dispute_resolved_in_favor_of_payee_releases() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let s = setup(&env);
    s.escrow.fund(&s.payer, &0);

    s.escrow.mark_delivered(&s.payee, &0);
    s.escrow.raise_dispute(&s.payee, &0);
    s.escrow.resolve_dispute(&s.arbiter, &0, &true);

    assert_eq!(s.escrow.get_milestone(&0).status, MilestoneStatus::Released);
    assert_eq!(s.token.balance(&s.payee), 300);
}

#[test]
fn claim_timelock_release_after_elapsed() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let s = setup(&env);
    s.escrow.fund(&s.payer, &0);
    s.escrow.mark_delivered(&s.payee, &0);

    env.ledger()
        .with_mut(|l| l.timestamp += 7 * 24 * 60 * 60 + 1);
    s.escrow.claim_timelock_release(&0);

    assert_eq!(s.escrow.get_milestone(&0).status, MilestoneStatus::Released);
    assert_eq!(s.token.balance(&s.payee), 300);
}

#[test]
#[should_panic]
fn claim_timelock_release_reverts_before_elapsed() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let s = setup(&env);
    s.escrow.fund(&s.payer, &0);
    s.escrow.mark_delivered(&s.payee, &0);

    s.escrow.claim_timelock_release(&0);
}

#[test]
fn mutual_cancel_refunds_only_funded_pending_milestones() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let s = setup(&env);
    // Only milestone 0 (300) funded — milestone 1's 700 never left the payer,
    // so cancelling should only refund the 300 that's actually in escrow.
    s.escrow.fund(&s.payer, &0);

    s.escrow.vote_cancel(&s.payer);
    assert!(!s.escrow.cancelled());
    s.escrow.vote_cancel(&s.payee);

    assert!(s.escrow.cancelled());
    assert_eq!(s.token.balance(&s.payer), 1_000);
}
