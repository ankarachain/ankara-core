#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, BytesN, Env, String,
};

use farmland_token::{FarmlandMetadata, FarmlandToken, FarmlandTokenClient};

use crate::contract::{SavingsCircle, SavingsCircleClient};
use crate::types::{CircleMode, CircleStatus};

const T0: u64 = 1_700_000_000;
const WEEK: u64 = 7 * 86_400;

fn usd<'a>(env: &'a Env, admin: &Address) -> FarmlandTokenClient<'a> {
    let s = |v: &str| String::from_str(env, v);
    let id = env.register(FarmlandToken, ());
    let c = FarmlandTokenClient::new(env, &id);
    c.initialize(
        &s("USD"), &s("USDX"), &BytesN::from_array(env, &[1u8; 32]), &s("NG"), admin, &None, &None,
        &FarmlandMetadata {
            location: s("n/a"), area_sq_meters: 0, soil_type: s("n/a"), irrigation_type: s("n/a"),
            crop_history: s("n/a"), title_document_hash: BytesN::from_array(env, &[0u8; 32]),
            valuation_usd: 0, state_region: s("n/a"), last_updated: 0,
        },
    );
    c
}

struct Setup<'a> {
    m: [Address; 3],
    token: FarmlandTokenClient<'a>,
    circles: SavingsCircleClient<'a>,
}

fn setup(env: &Env) -> Setup<'_> {
    env.ledger().with_mut(|l| l.timestamp = T0);
    let admin = Address::generate(env);
    let m = [Address::generate(env), Address::generate(env), Address::generate(env)];
    let token = usd(env, &admin);
    for a in m.iter() {
        token.mint(a, &10_000);
    }
    let id = env.register(SavingsCircle, ());
    Setup { m, token, circles: SavingsCircleClient::new(env, &id) }
}

fn rotating(t: &Setup) -> u64 {
    let id = t.circles.create_circle(&t.m[0], &t.token.address, &CircleMode::Rotating, &100, &WEEK, &3, &0, &0, &0);
    t.circles.join(&t.m[1], &id);
    t.circles.join(&t.m[2], &id); // full -> starts
    id
}

#[test]
fn rotating_circle_pays_each_member_once_in_join_order() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env);
    let id = rotating(&t);
    assert_eq!(t.circles.get_circle(&id).status, CircleStatus::Active);

    for round in 0..3u32 {
        let recipient = t.circles.current_recipient(&id).unwrap();
        assert_eq!(recipient, t.m[round as usize]);
        for a in t.m.iter() {
            t.circles.contribute(a, &id);
        }
        assert_eq!(t.circles.disburse(&id), 300);
    }
    // Everyone paid 300 in and received 300.
    for a in t.m.iter() {
        assert_eq!(t.token.balance(a), 10_000);
        assert!(t.circles.get_member(&id, a).paid_out);
    }
    assert_eq!(t.circles.get_circle(&id).status, CircleStatus::Completed);
    assert!(t.circles.try_contribute(&t.m[0], &id).is_err());
}

#[test]
fn rotating_round_waits_for_all_or_deadline_and_records_misses() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env);
    let id = rotating(&t);
    t.circles.contribute(&t.m[0], &id);
    t.circles.contribute(&t.m[1], &id);
    assert!(t.circles.try_contribute(&t.m[1], &id).is_err()); // once per round
    assert!(t.circles.try_disburse(&id).is_err()); // m2 missing, before deadline

    env.ledger().with_mut(|l| l.timestamp = T0 + WEEK);
    assert_eq!(t.circles.disburse(&id), 200);
    assert_eq!(t.circles.get_member(&id, &t.m[2]).missed, 1);
    assert_eq!(t.token.balance(&t.m[0]), 10_000 - 100 + 200);
}

#[test]
fn joining_rules() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env);
    let id = t.circles.create_circle(&t.m[0], &t.token.address, &CircleMode::Rotating, &100, &WEEK, &3, &0, &0, &0);
    assert!(t.circles.try_join(&t.m[0], &id).is_err()); // already a member
    assert!(t.circles.try_contribute(&t.m[0], &id).is_err()); // not active yet
    assert!(t.circles.try_start_circle(&t.m[1], &id).is_err()); // not organizer
    t.circles.join(&t.m[1], &id);
    t.circles.start_circle(&t.m[0], &id); // start early with 2
    assert_eq!(t.circles.get_circle(&id).rounds, 2);
    assert!(t.circles.try_join(&t.m[2], &id).is_err());
    assert!(t.circles.try_get_member(&id, &t.m[2]).is_err());
}

fn pooled(t: &Setup) -> u64 {
    // 3 members, 100/week for 4 weeks, borrow up to 2x savings, 10% fee.
    let id = t.circles.create_circle(&t.m[0], &t.token.address, &CircleMode::Pooled, &100, &WEEK, &3, &4, &20_000, &1_000);
    t.circles.join(&t.m[1], &id);
    t.circles.join(&t.m[2], &id);
    id
}

#[test]
fn pooled_circle_lends_against_savings_and_shares_fees() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env);
    let id = pooled(&t);

    for a in t.m.iter() {
        t.circles.contribute(a, &id);
    }
    // m0 saved 100 -> can borrow 200 (2x), pool holds 300.
    assert_eq!(t.circles.borrow_limit(&id, &t.m[0]), 200);
    assert!(t.circles.try_borrow(&t.m[0], &id, &201).is_err());
    t.circles.borrow(&t.m[0], &id, &200);
    assert!(t.circles.try_borrow(&t.m[0], &id, &1).is_err()); // one loan at a time
    assert_eq!(t.circles.get_circle(&id).pool_cash, 100);

    // Week 2 savings, then repay 200 + 20 fee.
    env.ledger().with_mut(|l| l.timestamp = T0 + WEEK);
    assert_eq!(t.circles.current_period(&id), 1);
    for a in t.m.iter() {
        t.circles.contribute(a, &id);
    }
    assert_eq!(t.circles.repay(&t.m[0], &id), 220);

    // After 4 periods: withdraw savings (200 each) + 20 fee / 3.
    assert!(t.circles.try_withdraw(&t.m[1], &id).is_err());
    env.ledger().with_mut(|l| l.timestamp = T0 + 4 * WEEK);
    assert!(t.circles.try_contribute(&t.m[1], &id).is_err());
    let s0 = t.circles.withdraw(&t.m[0], &id);
    let s1 = t.circles.withdraw(&t.m[1], &id);
    let s2 = t.circles.withdraw(&t.m[2], &id);
    assert_eq!((s0, s1, s2), (206, 206, 206));
    assert!(t.circles.try_withdraw(&t.m[0], &id).is_err());
    assert_eq!(t.token.balance(&t.m[1]), 10_006);
}

#[test]
fn pooled_defaulter_forfeits_savings_to_the_group() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env);
    let id = pooled(&t);
    for a in t.m.iter() {
        t.circles.contribute(a, &id);
    }
    t.circles.borrow(&t.m[2], &id, &200); // never repaid
    env.ledger().with_mut(|l| l.timestamp = T0 + 4 * WEEK);
    // Pool holds 100; m2's 100 of savings is forfeited; m0 & m1 split 100.
    assert_eq!(t.circles.withdraw(&t.m[0], &id), 50);
    assert_eq!(t.circles.withdraw(&t.m[1], &id), 50);
    assert!(t.circles.try_withdraw(&t.m[2], &id).is_err());
    assert!(t.circles.try_repay(&t.m[2], &id).is_err()); // closed
}

#[test]
fn mode_and_config_guards() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env);
    let r = rotating(&t);
    assert!(t.circles.try_borrow(&t.m[0], &r, &1).is_err());
    let p = pooled(&t);
    assert!(t.circles.try_disburse(&p).is_err());
    assert!(t.circles.try_create_circle(&t.m[0], &t.token.address, &CircleMode::Rotating, &0, &WEEK, &3, &0, &0, &0).is_err());
    assert!(t.circles.try_create_circle(&t.m[0], &t.token.address, &CircleMode::Rotating, &1, &WEEK, &1, &0, &0, &0).is_err());
    assert!(t.circles.try_create_circle(&t.m[0], &t.token.address, &CircleMode::Pooled, &1, &WEEK, &3, &0, &0, &0).is_err());
    assert_eq!(t.circles.circle_count(), 2);
}
