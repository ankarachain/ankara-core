#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    vec, Address, BytesN, Env, String,
};

use farmland_token::{FarmlandMetadata, FarmlandToken, FarmlandTokenClient};

use crate::contract::{RfqMarket, RfqMarketClient};
use crate::types::{IntentStatus, QuoteStatus};

const NOW: u64 = 1_700_000_000;

fn token<'a>(env: &'a Env, admin: &Address, sym: &str) -> FarmlandTokenClient<'a> {
    let s = |v: &str| String::from_str(env, v);
    let id = env.register(FarmlandToken, ());
    let c = FarmlandTokenClient::new(env, &id);
    c.initialize(
        &s(sym), &s(sym), &BytesN::from_array(env, &[1u8; 32]), &s("NG"), admin, &None, &None,
        &FarmlandMetadata {
            location: s("n/a"), area_sq_meters: 0, soil_type: s("n/a"), irrigation_type: s("n/a"),
            crop_history: s("n/a"), title_document_hash: BytesN::from_array(env, &[0u8; 32]),
            valuation_usd: 0, state_region: s("n/a"), last_updated: 0,
        },
    );
    c
}

struct Setup<'a> {
    seller: Address,
    b1: Address,
    b2: Address,
    treasury: Address,
    farm: FarmlandTokenClient<'a>,
    usd: FarmlandTokenClient<'a>,
    rfq: RfqMarketClient<'a>,
}

fn setup(env: &Env, fee_bps: u32) -> Setup<'_> {
    env.ledger().with_mut(|l| l.timestamp = NOW);
    let admin = Address::generate(env);
    let (seller, b1, b2, treasury) = (
        Address::generate(env), Address::generate(env), Address::generate(env), Address::generate(env),
    );
    let farm = token(env, &admin, "FARM");
    let usd = token(env, &admin, "USDX");
    farm.mint(&seller, &1_000);
    usd.mint(&b1, &1_000_000);
    usd.mint(&b2, &1_000_000);
    let id = env.register(RfqMarket, ());
    let rfq = RfqMarketClient::new(env, &id);
    rfq.initialize(&admin, &fee_bps, &treasury);
    Setup { seller, b1, b2, treasury, farm, usd, rfq }
}

#[test]
fn full_rfq_lifecycle_settles_atomically() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env, 100); // 1% fee
    let intent = t.rfq.post_intent(&t.seller, &t.farm.address, &400, &t.usd.address, &10_000, &(NOW + 86_400));
    assert_eq!(t.farm.balance(&t.rfq.address), 400);

    let q1 = t.rfq.submit_quote(&t.b1, &intent, &12_000, &(NOW + 3_600));
    let q2 = t.rfq.submit_quote(&t.b2, &intent, &15_000, &(NOW + 3_600));
    assert_eq!(t.rfq.quotes_for(&intent), vec![&env, q1, q2]);
    assert_eq!(t.usd.balance(&t.rfq.address), 27_000);

    t.rfq.accept_quote(&t.seller, &intent, &q2);
    assert_eq!(t.farm.balance(&t.b2), 400);
    assert_eq!(t.usd.balance(&t.seller), 14_850);
    assert_eq!(t.usd.balance(&t.treasury), 150);
    let i = t.rfq.get_intent(&intent);
    assert_eq!(i.status, IntentStatus::Filled);
    assert_eq!(i.accepted_quote, Some(q2));
    assert_eq!(t.rfq.get_quote(&q2).status, QuoteStatus::Accepted);

    // Losing quote refunded.
    t.rfq.withdraw_quote(&t.b1, &q1);
    assert_eq!(t.usd.balance(&t.b1), 1_000_000);
    assert_eq!(t.usd.balance(&t.rfq.address), 0);
    assert_eq!(t.farm.balance(&t.rfq.address), 0);

    // Filled intent can't take more quotes or settle again.
    assert!(t.rfq.try_submit_quote(&t.b1, &intent, &20_000, &(NOW + 10)).is_err());
    assert!(t.rfq.try_accept_quote(&t.seller, &intent, &q1).is_err());
    assert_eq!(t.rfq.intents_for_token(&t.farm.address), vec![&env, intent]);
}

#[test]
fn cancel_intent_refunds_seller() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env, 0);
    let intent = t.rfq.post_intent(&t.seller, &t.farm.address, &100, &t.usd.address, &0, &(NOW + 100));
    let q = t.rfq.submit_quote(&t.b1, &intent, &50, &(NOW + 100));
    assert!(t.rfq.try_cancel_intent(&t.b1, &intent).is_err());
    t.rfq.cancel_intent(&t.seller, &intent);
    assert_eq!(t.farm.balance(&t.seller), 1_000);
    assert!(t.rfq.try_accept_quote(&t.seller, &intent, &q).is_err());
    t.rfq.withdraw_quote(&t.b1, &q);
    assert_eq!(t.usd.balance(&t.b1), 1_000_000);
}

#[test]
fn guards() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env, 0);
    let intent = t.rfq.post_intent(&t.seller, &t.farm.address, &100, &t.usd.address, &1_000, &(NOW + 100));
    // Below floor, self-quote, bad expiry.
    assert!(t.rfq.try_submit_quote(&t.b1, &intent, &999, &(NOW + 10)).is_err());
    assert!(t.rfq.try_submit_quote(&t.seller, &intent, &5_000, &(NOW + 10)).is_err());
    assert!(t.rfq.try_submit_quote(&t.b1, &intent, &5_000, &NOW).is_err());
    let q = t.rfq.submit_quote(&t.b1, &intent, &1_000, &(NOW + 10));
    // Only the buyer withdraws; only the seller accepts.
    assert!(t.rfq.try_withdraw_quote(&t.b2, &q).is_err());
    assert!(t.rfq.try_accept_quote(&t.b1, &intent, &q).is_err());
    // Expired quote can't be accepted.
    env.ledger().with_mut(|l| l.timestamp = NOW + 11);
    assert!(t.rfq.try_accept_quote(&t.seller, &intent, &q).is_err());
    // Expired intent can't take quotes.
    env.ledger().with_mut(|l| l.timestamp = NOW + 101);
    assert!(t.rfq.try_submit_quote(&t.b2, &intent, &2_000, &(NOW + 500)).is_err());
    // Bad intents.
    assert!(t.rfq.try_post_intent(&t.seller, &t.farm.address, &0, &t.usd.address, &0, &(NOW + 1_000)).is_err());
    assert!(t.rfq.try_post_intent(&t.seller, &t.farm.address, &1, &t.usd.address, &0, &NOW).is_err());
}

#[test]
fn quote_for_other_intent_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env, 0);
    let i1 = t.rfq.post_intent(&t.seller, &t.farm.address, &10, &t.usd.address, &0, &(NOW + 100));
    let i2 = t.rfq.post_intent(&t.seller, &t.farm.address, &10, &t.usd.address, &0, &(NOW + 100));
    let q = t.rfq.submit_quote(&t.b1, &i1, &5, &(NOW + 100));
    assert!(t.rfq.try_accept_quote(&t.seller, &i2, &q).is_err());
}

#[test]
fn fee_is_capped_and_pause_blocks_new_activity_only() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env, 0);
    assert!(t.rfq.try_set_fee(&501, &t.treasury).is_err());
    t.rfq.set_fee(&250, &t.treasury);
    assert_eq!(t.rfq.fee_bps(), 250);

    let intent = t.rfq.post_intent(&t.seller, &t.farm.address, &10, &t.usd.address, &0, &(NOW + 100));
    let q = t.rfq.submit_quote(&t.b1, &intent, &5, &(NOW + 100));
    t.rfq.pause();
    assert!(t.rfq.try_post_intent(&t.seller, &t.farm.address, &10, &t.usd.address, &0, &(NOW + 100)).is_err());
    assert!(t.rfq.try_accept_quote(&t.seller, &intent, &q).is_err());
    // Exits stay open.
    t.rfq.withdraw_quote(&t.b1, &q);
    t.rfq.cancel_intent(&t.seller, &intent);
}
