#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    vec, Address, BytesN, Env, String,
};

use farmland_token::{FarmlandMetadata, FarmlandToken, FarmlandTokenClient};

use crate::contract::{PaymentStream, PaymentStreamClient};
use crate::stream::Tranche;

const T0: u64 = 1_700_000_000;

fn deploy_token<'a>(env: &'a Env, admin: &Address) -> FarmlandTokenClient<'a> {
    let s = |v: &str| String::from_str(env, v);
    let id = env.register(FarmlandToken, ());
    let client = FarmlandTokenClient::new(env, &id);
    client.initialize(
        &s("USD Stable"),
        &s("USDX"),
        &BytesN::from_array(env, &[1u8; 32]),
        &s("NG"),
        admin,
        &None,
        &None,
        &FarmlandMetadata {
            location: s("n/a"),
            area_sq_meters: 0,
            soil_type: s("n/a"),
            irrigation_type: s("n/a"),
            crop_history: s("n/a"),
            title_document_hash: BytesN::from_array(env, &[0u8; 32]),
            valuation_usd: 0,
            state_region: s("n/a"),
            last_updated: 0,
        },
    );
    client
}

struct Setup<'a> {
    sender: Address,
    recipient: Address,
    token: FarmlandTokenClient<'a>,
    streams: PaymentStreamClient<'a>,
}

fn setup(env: &Env) -> Setup<'_> {
    env.ledger().with_mut(|l| l.timestamp = T0);
    let admin = Address::generate(env);
    let sender = Address::generate(env);
    let recipient = Address::generate(env);
    let token = deploy_token(env, &admin);
    token.mint(&sender, &1_000_000);
    let id = env.register(PaymentStream, ());
    let streams = PaymentStreamClient::new(env, &id);
    Setup { sender, recipient, token, streams }
}

fn at(env: &Env, t: u64) {
    env.ledger().with_mut(|l| l.timestamp = t);
}

#[test]
fn linear_stream_accrues_per_second() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env);
    let id = t.streams.create_stream(&t.sender, &t.recipient, &t.token.address, &1_000, &T0, &T0, &(T0 + 1_000), &false);
    assert_eq!(t.token.balance(&t.streams.address), 1_000);
    assert_eq!(t.streams.claimable(&id), 0);

    at(&env, T0 + 250);
    assert_eq!(t.streams.claimable(&id), 250);
    assert_eq!(t.streams.withdraw(&t.recipient, &id, &None), 250);
    assert_eq!(t.token.balance(&t.recipient), 250);
    assert_eq!(t.streams.claimable(&id), 0);

    at(&env, T0 + 600);
    assert_eq!(t.streams.claimable(&id), 350);
    t.streams.withdraw(&t.recipient, &id, &Some(100));
    assert_eq!(t.streams.claimable(&id), 250);

    at(&env, T0 + 5_000);
    assert_eq!(t.streams.claimable(&id), 650);
    t.streams.withdraw(&t.recipient, &id, &None);
    assert_eq!(t.token.balance(&t.recipient), 1_000);
    assert_eq!(t.streams.get_stream(&id).withdrawn, 1_000);
}

#[test]
fn cliff_blocks_then_releases_accrued() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env);
    let id = t.streams.create_stream(&t.sender, &t.recipient, &t.token.address, &1_200, &T0, &(T0 + 300), &(T0 + 1_200), &false);
    at(&env, T0 + 299);
    assert_eq!(t.streams.claimable(&id), 0);
    assert!(t.streams.try_withdraw(&t.recipient, &id, &None).is_err());
    at(&env, T0 + 300);
    assert_eq!(t.streams.claimable(&id), 300);
}

#[test]
fn tranche_schedule_unlocks_in_steps() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env);
    let tranches = vec![
        &env,
        Tranche { unlock_time: T0 + 100, amount: 300 },
        Tranche { unlock_time: T0 + 200, amount: 300 },
        Tranche { unlock_time: T0 + 300, amount: 400 },
    ];
    let id = t.streams.create_schedule(&t.sender, &t.recipient, &t.token.address, &tranches, &false);
    assert_eq!(t.streams.get_stream(&id).total_amount, 1_000);
    assert_eq!(t.token.balance(&t.sender), 999_000);

    at(&env, T0 + 150);
    assert_eq!(t.streams.claimable(&id), 300);
    at(&env, T0 + 200);
    assert_eq!(t.streams.claimable(&id), 600);
    at(&env, T0 + 10_000);
    assert_eq!(t.streams.vested(&id), 1_000);
}

#[test]
fn cancel_splits_vested_and_unvested() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env);
    let id = t.streams.create_stream(&t.sender, &t.recipient, &t.token.address, &1_000, &T0, &T0, &(T0 + 1_000), &true);
    at(&env, T0 + 400);
    t.streams.withdraw(&t.recipient, &id, &Some(100));
    let (paid, refunded) = t.streams.cancel(&t.sender, &id);
    assert_eq!((paid, refunded), (300, 600));
    assert_eq!(t.token.balance(&t.recipient), 400);
    assert_eq!(t.token.balance(&t.sender), 999_000 + 600);
    assert_eq!(t.token.balance(&t.streams.address), 0);

    // Nothing more accrues after cancellation.
    at(&env, T0 + 900);
    assert_eq!(t.streams.claimable(&id), 0);
    assert!(t.streams.try_cancel(&t.sender, &id).is_err());
    assert_eq!(t.streams.get_stream(&id).refunded, 600);
}

#[test]
fn non_cancelable_stream_cannot_be_cancelled() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env);
    let id = t.streams.create_stream(&t.sender, &t.recipient, &t.token.address, &1_000, &T0, &T0, &(T0 + 10), &false);
    assert!(t.streams.try_cancel(&t.sender, &id).is_err());
}

#[test]
fn only_parties_can_act() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env);
    let stranger = Address::generate(&env);
    let id = t.streams.create_stream(&t.sender, &t.recipient, &t.token.address, &1_000, &T0, &T0, &(T0 + 10), &true);
    at(&env, T0 + 5);
    assert!(t.streams.try_withdraw(&stranger, &id, &None).is_err());
    assert!(t.streams.try_cancel(&stranger, &id).is_err());
    assert!(t.streams.try_withdraw(&t.recipient, &id, &Some(501)).is_err());
}

#[test]
fn rejects_invalid_schedules() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env);
    let (s, r, tok) = (&t.sender, &t.recipient, &t.token.address);
    assert!(t.streams.try_create_stream(s, r, tok, &0, &T0, &T0, &(T0 + 1), &false).is_err());
    assert!(t.streams.try_create_stream(s, r, tok, &10, &T0, &T0, &T0, &false).is_err());
    assert!(t.streams.try_create_stream(s, r, tok, &10, &T0, &(T0 + 5), &(T0 + 4), &false).is_err());
    let unordered = vec![
        &env,
        Tranche { unlock_time: T0 + 2, amount: 1 },
        Tranche { unlock_time: T0 + 1, amount: 1 },
    ];
    assert!(t.streams.try_create_schedule(s, r, tok, &unordered, &false).is_err());
    assert!(t.streams.try_create_schedule(s, r, tok, &vec![&env], &false).is_err());
}

#[test]
fn indexes_by_party() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env);
    let a = t.streams.create_stream(&t.sender, &t.recipient, &t.token.address, &10, &T0, &T0, &(T0 + 10), &false);
    let b = t.streams.create_stream(&t.sender, &t.recipient, &t.token.address, &10, &T0, &T0, &(T0 + 10), &false);
    assert_eq!(t.streams.streams_by_sender(&t.sender), vec![&env, a, b]);
    assert_eq!(t.streams.streams_by_recipient(&t.recipient), vec![&env, a, b]);
    assert_eq!(t.streams.stream_count(), 2);
}

#[test]
fn create_requires_sender_auth() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env);
    t.streams.create_stream(&t.sender, &t.recipient, &t.token.address, &10, &T0, &T0, &(T0 + 10), &false);
    let authorized = env.auths().iter().any(|(addr, _)| *addr == t.sender);
    assert!(authorized);
}
