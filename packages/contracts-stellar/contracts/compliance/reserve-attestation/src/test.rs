#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    vec, Address, BytesN, Env, String,
};

use farmland_token::{FarmlandMetadata, FarmlandToken, FarmlandTokenClient};

use crate::contract::{ReserveAttestation, ReserveAttestationClient};

fn s(env: &Env, v: &str) -> String {
    String::from_str(env, v)
}

fn h(env: &Env, b: u8) -> BytesN<32> {
    BytesN::from_array(env, &[b; 32])
}

fn deploy_token<'a>(env: &'a Env, admin: &Address) -> FarmlandTokenClient<'a> {
    let id = env.register(FarmlandToken, ());
    let client = FarmlandTokenClient::new(env, &id);
    client.initialize(
        &s(env, "Naira Stable"),
        &s(env, "cNGN"),
        &h(env, 1),
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
            title_document_hash: h(env, 0),
            valuation_usd: 0,
            state_region: s(env, "n/a"),
            last_updated: 0,
        },
    );
    client
}

struct Setup<'a> {
    a1: Address,
    a2: Address,
    a3: Address,
    token: FarmlandTokenClient<'a>,
    reserve: ReserveAttestationClient<'a>,
}

fn setup(env: &Env, quorum: u32) -> Setup<'_> {
    env.ledger().with_mut(|l| l.timestamp = 1_700_000_000);
    let admin = Address::generate(env);
    let (a1, a2, a3) = (
        Address::generate(env),
        Address::generate(env),
        Address::generate(env),
    );
    let token = deploy_token(env, &admin);
    token.mint(&Address::generate(env), &1_000_000);
    let id = env.register(ReserveAttestation, ());
    let reserve = ReserveAttestationClient::new(env, &id);
    reserve.initialize(
        &admin,
        &token.address,
        &vec![env, a1.clone(), a2.clone(), a3.clone()],
        &quorum,
        &86_400,
    );
    Setup { a1, a2, a3, token, reserve }
}

#[test]
fn no_report_is_stale_and_not_backed() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env, 1);
    assert!(t.reserve.latest_report().is_none());
    assert_eq!(t.reserve.get_reserve(), (0, 0));
    assert!(t.reserve.is_stale());
    assert!(!t.reserve.is_fully_backed());
}

#[test]
fn single_attestor_quorum_finalizes_immediately() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env, 1);
    assert!(t.reserve.submit(&t.a1, &1_000_000, &h(&env, 9)));
    let r = t.reserve.latest_report().unwrap();
    assert_eq!(r.round, 1);
    assert_eq!(r.amount, 1_000_000);
    assert_eq!(r.attestor_count, 1);
    assert_eq!(r.report_hash, h(&env, 9));
    assert!(!t.reserve.is_stale());
    assert_eq!(t.reserve.outstanding_supply(), 1_000_000);
    assert_eq!(t.reserve.collateralization_bps(), 10_000);
    assert!(t.reserve.is_fully_backed());
    assert_eq!(t.reserve.pending_round().round, 2);
}

#[test]
fn quorum_uses_lowest_submission() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env, 2);
    assert!(!t.reserve.submit(&t.a1, &1_200_000, &h(&env, 1)));
    assert!(t.reserve.latest_report().is_none());
    assert_eq!(t.reserve.pending_round().submissions.len(), 1);

    assert!(t.reserve.submit(&t.a2, &900_000, &h(&env, 2)));
    let r = t.reserve.latest_report().unwrap();
    assert_eq!(r.amount, 900_000);
    assert_eq!(r.report_hash, h(&env, 2));
    assert_eq!(r.attestor_count, 2);
    // 900k reserve vs 1M supply -> 90%, not fully backed.
    assert_eq!(t.reserve.collateralization_bps(), 9_000);
    assert!(!t.reserve.is_fully_backed());
    assert_eq!(t.reserve.get_report(&1).amount, 900_000);
}

#[test]
fn duplicate_and_unknown_attestors_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env, 2);
    t.reserve.submit(&t.a1, &1, &h(&env, 1));
    assert!(t.reserve.try_submit(&t.a1, &1, &h(&env, 1)).is_err());
    assert!(t
        .reserve
        .try_submit(&Address::generate(&env), &1, &h(&env, 1))
        .is_err());
    assert!(t.reserve.try_submit(&t.a3, &-1, &h(&env, 1)).is_err());
}

#[test]
fn reports_go_stale() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env, 1);
    t.reserve.submit(&t.a1, &2_000_000, &h(&env, 1));
    assert!(t.reserve.is_fully_backed());
    env.ledger().with_mut(|l| l.timestamp += 86_401);
    assert!(t.reserve.is_stale());
    assert!(!t.reserve.is_fully_backed());
}

#[test]
fn stale_pending_round_is_discarded() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env, 2);
    t.reserve.submit(&t.a1, &5_000_000, &h(&env, 1));
    env.ledger().with_mut(|l| l.timestamp += 86_401);
    // a1's old submission is dropped; a2 alone doesn't reach quorum.
    assert!(!t.reserve.submit(&t.a2, &1_000_000, &h(&env, 2)));
    assert_eq!(t.reserve.pending_round().submissions.len(), 1);
    assert!(t.reserve.submit(&t.a1, &1_100_000, &h(&env, 3)));
    assert_eq!(t.reserve.latest_report().unwrap().amount, 1_000_000);
}

#[test]
fn backing_tracks_live_supply() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env, 1);
    t.reserve.submit(&t.a1, &1_000_000, &h(&env, 1));
    assert!(t.reserve.is_fully_backed());
    t.token.mint(&Address::generate(&env), &1);
    assert!(!t.reserve.is_fully_backed());
}

#[test]
fn attestor_and_quorum_management() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env, 3);
    // Can't drop below quorum.
    assert!(t.reserve.try_remove_attestor(&t.a3).is_err());
    t.reserve.set_quorum(&2);
    t.reserve.submit(&t.a3, &10, &h(&env, 1));
    t.reserve.remove_attestor(&t.a3);
    // Pending round (with a3's submission) was discarded.
    assert_eq!(t.reserve.pending_round().submissions.len(), 0);
    assert_eq!(t.reserve.attestors().len(), 2);
    assert!(t.reserve.try_set_quorum(&3).is_err());
    assert!(t.reserve.try_set_quorum(&0).is_err());
    let a4 = Address::generate(&env);
    t.reserve.add_attestor(&a4);
    assert!(t.reserve.try_add_attestor(&a4).is_err());
    t.reserve.set_quorum(&3);
    assert_eq!(t.reserve.quorum(), 3);
}

#[test]
#[should_panic]
fn initialize_rejects_bad_quorum() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(ReserveAttestation, ());
    let reserve = ReserveAttestationClient::new(&env, &id);
    let a = Address::generate(&env);
    reserve.initialize(&a, &a, &vec![&env, a.clone()], &2, &100);
}

#[test]
#[should_panic]
fn submit_requires_attestor_auth() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let a1 = Address::generate(&env);
    let id = env.register(ReserveAttestation, ());
    let reserve = ReserveAttestationClient::new(&env, &id);
    reserve.initialize(&admin, &admin, &vec![&env, a1.clone()], &1, &100);
    reserve.submit(&a1, &1, &h(&env, 1));
}
