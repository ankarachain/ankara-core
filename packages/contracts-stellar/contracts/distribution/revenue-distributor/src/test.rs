#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    vec, Address, BytesN, Env, String,
};

use farmland_token::{FarmlandMetadata, FarmlandToken, FarmlandTokenClient};
use real_estate_token::{RealEstateMetadata, RealEstateToken, RealEstateTokenClient};

use crate::contract::{RevenueDistributor, RevenueDistributorClient};

fn s(env: &Env, v: &str) -> String {
    String::from_str(env, v)
}

fn deploy_usd<'a>(env: &'a Env, admin: &Address) -> FarmlandTokenClient<'a> {
    let id = env.register(FarmlandToken, ());
    let c = FarmlandTokenClient::new(env, &id);
    c.initialize(
        &s(env, "USD"), &s(env, "USDX"), &BytesN::from_array(env, &[1u8; 32]), &s(env, "NG"),
        admin, &None, &None,
        &FarmlandMetadata {
            location: s(env, "n/a"), area_sq_meters: 0, soil_type: s(env, "n/a"),
            irrigation_type: s(env, "n/a"), crop_history: s(env, "n/a"),
            title_document_hash: BytesN::from_array(env, &[0u8; 32]), valuation_usd: 0,
            state_region: s(env, "n/a"), last_updated: 0,
        },
    );
    c
}

fn deploy_building<'a>(env: &'a Env, admin: &Address) -> RealEstateTokenClient<'a> {
    let id = env.register(RealEstateToken, ());
    let c = RealEstateTokenClient::new(env, &id);
    c.initialize(
        &s(env, "Lekki Tower"), &s(env, "LKT"), &BytesN::from_array(env, &[2u8; 32]), &s(env, "NG"),
        admin, &None, &None,
        &RealEstateMetadata {
            property_id: s(env, "LA-001"), property_type: s(env, "residential"),
            location_address: s(env, "Lekki"), total_area_sq_meters: 1_000,
            title_document_hash: BytesN::from_array(env, &[3u8; 32]), valuation_usd: 1_000_000,
            rental_yield_bps: 800, occupancy_status: s(env, "occupied"),
            developer_address: admin.clone(), last_updated: 0,
        },
    );
    c
}

struct Setup<'a> {
    issuer: Address,
    a: Address,
    b: Address,
    c: Address,
    usd: FarmlandTokenClient<'a>,
    building: RealEstateTokenClient<'a>,
    dist: RevenueDistributorClient<'a>,
}

fn setup(env: &Env) -> Setup<'_> {
    env.ledger().with_mut(|l| l.timestamp = 1_700_000_000);
    let issuer = Address::generate(env);
    let (a, b, c) = (Address::generate(env), Address::generate(env), Address::generate(env));
    let usd = deploy_usd(env, &issuer);
    let building = deploy_building(env, &issuer);
    building.mint(&a, &500);
    building.mint(&b, &300);
    building.mint(&c, &200);
    usd.mint(&issuer, &1_000_000);
    let id = env.register(RevenueDistributor, ());
    Setup { issuer, a, b, c, usd, building, dist: RevenueDistributorClient::new(env, &id) }
}

#[test]
fn pays_pro_rata_at_snapshot_even_after_transfers() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env);
    let id = t.dist.create_distribution(&t.issuer, &t.building.address, &t.usd.address, &10_000, &0, &s(&env, "Rent Q3 2026"));
    assert_eq!(t.usd.balance(&t.dist.address), 10_000);

    // a sells everything after the snapshot — still owed for this period.
    t.building.transfer(&t.a, &t.b, &500);

    assert_eq!(t.dist.claimable(&t.a, &id), 5_000);
    assert_eq!(t.dist.claim(&t.a, &id), 5_000);
    assert_eq!(t.dist.claim(&t.b, &id), 3_000);
    assert_eq!(t.dist.claim(&t.c, &id), 2_000);
    assert_eq!(t.usd.balance(&t.a), 5_000);
    assert_eq!(t.usd.balance(&t.dist.address), 0);
    assert_eq!(t.dist.get_distribution(&id).claimed_amount, 10_000);

    // Double-claim rejected; non-holder has nothing.
    assert!(t.dist.try_claim(&t.a, &id).is_err());
    assert_eq!(t.dist.claimable(&Address::generate(&env), &id), 0);

    // Next period uses the new balances.
    let id2 = t.dist.create_distribution(&t.issuer, &t.building.address, &t.usd.address, &1_000, &0, &s(&env, "Rent Q4"));
    assert_eq!(t.dist.claimable(&t.a, &id2), 0);
    assert_eq!(t.dist.claimable(&t.b, &id2), 800);
    assert_eq!(t.dist.distributions_for(&t.building.address), vec![&env, id, id2]);
}

#[test]
fn claim_many_skips_empty_and_claimed() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env);
    let d1 = t.dist.create_distribution(&t.issuer, &t.building.address, &t.usd.address, &1_000, &0, &s(&env, "1"));
    let d2 = t.dist.create_distribution(&t.issuer, &t.building.address, &t.usd.address, &2_000, &0, &s(&env, "2"));
    t.dist.claim(&t.c, &d1);
    assert_eq!(t.dist.claim_many(&t.c, &vec![&env, d1, d2]), 400);
    assert!(t.dist.has_claimed(&t.c, &d2));
}

#[test]
fn deadline_and_reclaim() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env);
    let id = t.dist.create_distribution(&t.issuer, &t.building.address, &t.usd.address, &10_000, &86_400, &s(&env, "Royalty"));
    t.dist.claim(&t.a, &id);
    assert!(t.dist.try_reclaim(&t.issuer, &id).is_err()); // window still open

    env.ledger().with_mut(|l| l.timestamp += 86_401);
    assert_eq!(t.dist.claimable(&t.b, &id), 0);
    assert!(t.dist.try_claim(&t.b, &id).is_err());
    assert!(t.dist.try_reclaim(&t.a, &id).is_err()); // not creator
    assert_eq!(t.dist.reclaim(&t.issuer, &id), 5_000);
    assert!(t.dist.try_reclaim(&t.issuer, &id).is_err());
    assert_eq!(t.usd.balance(&t.issuer), 1_000_000 - 10_000 + 5_000);
}

#[test]
fn only_token_manager_can_distribute() {
    let env = Env::default();
    let t = {
        env.mock_all_auths();
        setup(&env)
    };
    let outsider = Address::generate(&env);
    t.usd.mint(&outsider, &1_000);
    // Only the outsider signs: the nested token.snapshot() needs the
    // issuer's (token Manager's) auth, which isn't given.
    use soroban_sdk::testutils::{MockAuth, MockAuthInvoke};
    use soroban_sdk::IntoVal;
    let memo = s(&env, "x");
    env.mock_auths(&[MockAuth {
        address: &outsider,
        invoke: &MockAuthInvoke {
            contract: &t.dist.address,
            fn_name: "create_distribution",
            args: (&outsider, &t.building.address, &t.usd.address, 100i128, 0u64, memo.clone()).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    assert!(t
        .dist
        .try_create_distribution(&outsider, &t.building.address, &t.usd.address, &100, &0, &memo)
        .is_err());
}

#[test]
fn rejects_bad_input() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env);
    assert!(t.dist.try_create_distribution(&t.issuer, &t.building.address, &t.usd.address, &0, &0, &s(&env, "")).is_err());
    assert!(t.dist.try_get_distribution(&42).is_err());
}
