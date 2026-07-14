#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, BytesN, Env, String,
};

use farmland_token::{FarmlandMetadata, FarmlandToken, FarmlandTokenClient};
use manual_oracle::{ManualOracle, ManualOracleClient};

use crate::contract::{CollateralVault, CollateralVaultClient};
use crate::loan::LoanStatus;

const PRICE_SCALE: i128 = 1_000_000_000_000_000_000;

fn deploy_token<'a>(env: &'a Env, admin: &Address, symbol: &str) -> FarmlandTokenClient<'a> {
    let contract_id = env.register(FarmlandToken, ());
    let client = FarmlandTokenClient::new(env, &contract_id);
    client.initialize(
        &String::from_str(env, symbol),
        &String::from_str(env, symbol),
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

fn deploy_oracle<'a>(env: &'a Env, admin: &Address) -> ManualOracleClient<'a> {
    let contract_id = env.register(ManualOracle, ());
    let client = ManualOracleClient::new(env, &contract_id);
    client.initialize(admin, &86_400u64);
    client
}

struct Setup<'a> {
    admin: Address,
    borrower: Address,
    collateral: FarmlandTokenClient<'a>,
    borrowed: FarmlandTokenClient<'a>,
    oracle: ManualOracleClient<'a>,
    vault: CollateralVaultClient<'a>,
}

/// Collateral priced at $1.00/unit (1e18 scale). 60% LTV / 75% liquidation
/// threshold, matching the plan's example config.
fn setup(env: &Env) -> Setup<'_> {
    // manual-oracle treats a price posted at ledger timestamp 0 as "never
    // set" (its is_stale() sentinel) — advance the clock first so a price
    // set during setup isn't immediately (falsely) stale.
    env.ledger().with_mut(|l| l.timestamp = 1_000);

    let admin = Address::generate(env);
    let borrower = Address::generate(env);

    let collateral = deploy_token(env, &admin, "COLL");
    let borrowed = deploy_token(env, &admin, "USDX");
    let oracle = deploy_oracle(env, &admin);
    oracle.set_price(&collateral.address, &PRICE_SCALE);

    let contract_id = env.register(CollateralVault, ());
    let vault = CollateralVaultClient::new(env, &contract_id);
    vault.initialize(&admin, &borrowed.address, &oracle.address, &6000u32, &7500u32);

    collateral.mint(&borrower, &1_000);
    // Pre-seed the vault's own balance of the borrowed asset — v1 has no
    // separate lending-pool/interest-accrual mechanism (see contract.rs).
    borrowed.mint(&vault.address, &10_000);

    Setup { admin, borrower, collateral, borrowed, oracle, vault }
}

#[test]
fn open_loan_transfers_collateral_in_and_borrowed_out() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let s = setup(&env);

    let loan_id = s.vault.open_loan(&s.borrower, &s.collateral.address, &1_000, &600);

    assert_eq!(s.collateral.balance(&s.borrower), 0);
    assert_eq!(s.collateral.balance(&s.vault.address), 1_000);
    assert_eq!(s.borrowed.balance(&s.borrower), 600);

    let loan = s.vault.get_loan(&loan_id);
    assert_eq!(loan.status, LoanStatus::Open);
    assert_eq!(loan.collateral_amount, 1_000);
    assert_eq!(loan.borrowed_amount, 600);
}

#[test]
#[should_panic]
fn open_loan_rejects_amount_exceeding_ltv() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let s = setup(&env);

    // Max borrowable at 60% LTV on 1000 units @ $1 is 600 — 601 must revert.
    s.vault.open_loan(&s.borrower, &s.collateral.address, &1_000, &601);
}

#[test]
#[should_panic]
fn open_loan_rejects_stale_oracle_price() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let s = setup(&env);

    // borrowed_token has never had a price posted — is_stale() is true.
    s.vault.open_loan(&s.borrower, &s.borrowed.address, &1_000, &1);
}

#[test]
fn open_loan_requires_root_level_borrower_auth() {
    // Regression test, same rationale as milestone-escrow's equivalent:
    // catches a missing top-level `caller.require_auth()` that a nested
    // token-transfer auth requirement alone wouldn't surface under
    // `mock_all_auths_allowing_non_root_auth()`.
    let env = Env::default();
    env.mock_all_auths();
    let s = setup(&env);

    s.vault.open_loan(&s.borrower, &s.collateral.address, &1_000, &600);

    let authorized = env.auths().iter().any(|(addr, _)| *addr == s.borrower);
    assert!(authorized, "open_loan did not require the borrower's authorization");
}

#[test]
fn repay_loan_releases_collateral() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let s = setup(&env);

    let loan_id = s.vault.open_loan(&s.borrower, &s.collateral.address, &1_000, &600);
    s.vault.repay_loan(&s.borrower, &loan_id);

    assert_eq!(s.vault.get_loan(&loan_id).status, LoanStatus::Repaid);
    assert_eq!(s.collateral.balance(&s.borrower), 1_000);
    assert_eq!(s.borrowed.balance(&s.borrower), 0);
}

#[test]
fn liquidate_moves_collateral_to_manager_once_undercollateralized() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let s = setup(&env);

    let loan_id = s.vault.open_loan(&s.borrower, &s.collateral.address, &1_000, &600);
    assert!(!s.vault.is_liquidatable(&loan_id));

    // Collateral value drops from $1000 to $700 — current LTV becomes
    // 600 * 10000 / 700 ≈ 8571 bps, over the 7500 bps liquidation threshold.
    s.oracle.set_price(&s.collateral.address, &(700 * PRICE_SCALE / 1_000));
    assert!(s.vault.is_liquidatable(&loan_id));

    s.vault.liquidate(&loan_id);

    assert_eq!(s.vault.get_loan(&loan_id).status, LoanStatus::Liquidated);
    assert_eq!(s.collateral.balance(&s.admin), 1_000);
    assert_eq!(s.collateral.balance(&s.vault.address), 0);
}

#[test]
#[should_panic]
fn liquidate_reverts_while_healthy() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let s = setup(&env);

    let loan_id = s.vault.open_loan(&s.borrower, &s.collateral.address, &1_000, &600);
    s.vault.liquidate(&loan_id);
}

#[test]
fn set_ltv_bps_updates_config() {
    // require_role() (ankara_common::roles) is the same admin-gating
    // primitive every other contract in this workspace already relies on
    // for its admin functions — not re-verified here beyond confirming the
    // call succeeds and the new value is stored.
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let s = setup(&env);

    s.vault.set_ltv_bps(&5000);
    assert_eq!(s.vault.ltv_bps(), 5000);
}

#[test]
#[should_panic]
fn set_ltv_bps_rejects_value_at_or_above_liquidation_threshold() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let s = setup(&env);

    // Liquidation threshold is 7500 — an LTV of 7500 or higher is invalid.
    s.vault.set_ltv_bps(&7500);
}

#[test]
fn pause_blocks_open_loan() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let s = setup(&env);

    s.vault.pause();
    let result = s.vault.try_open_loan(&s.borrower, &s.collateral.address, &1_000, &600);
    assert!(result.is_err());
}
