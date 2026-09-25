use soroban_sdk::{contracttype, panic_with_error, Address, Env, Vec};

use crate::errors::VaultError;

/// v1 scope: undercollateralization-only liquidation, no loan maturity/due
/// date. A `due_at` field + overdue check is a small, independent fast-follow
/// if time-based liquidation is wanted later.
#[contracttype]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum LoanStatus {
    Open,
    Repaid,
    Liquidated,
    /// A score-based loan not repaid by its due date (see `credit.rs`).
    Defaulted,
}

#[contracttype]
#[derive(Clone)]
pub struct Loan {
    pub borrower: Address,
    pub collateral_token: Address,
    pub collateral_amount: i128,
    pub borrowed_token: Address,
    pub borrowed_amount: i128,
    /// LTV at open time, locked in — doesn't drift if the vault's global
    /// `LtvBps` config changes later.
    pub ltv_bps: u32,
    pub opened_at: u64,
    pub status: LoanStatus,
}

const DAY_IN_LEDGERS: u32 = 17280;
const LOAN_BUMP_AMOUNT: u32 = 180 * DAY_IN_LEDGERS;
const LOAN_LIFETIME_THRESHOLD: u32 = LOAN_BUMP_AMOUNT - DAY_IN_LEDGERS;

#[contracttype]
enum DataKey {
    BorrowedToken,
    Oracle,
    LtvBps,
    LiquidationThresholdBps,
    NextLoanId,
    Loan(u64),
    BorrowerLoans(Address),
}

pub fn init_config(
    env: &Env,
    borrowed_token: Address,
    oracle: Address,
    ltv_bps: u32,
    liquidation_threshold_bps: u32,
) {
    env.storage()
        .instance()
        .set(&DataKey::BorrowedToken, &borrowed_token);
    env.storage().instance().set(&DataKey::Oracle, &oracle);
    env.storage().instance().set(&DataKey::LtvBps, &ltv_bps);
    env.storage()
        .instance()
        .set(&DataKey::LiquidationThresholdBps, &liquidation_threshold_bps);
    env.storage().instance().set(&DataKey::NextLoanId, &0u64);
}

pub fn borrowed_token(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::BorrowedToken).unwrap()
}

pub fn oracle(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Oracle).unwrap()
}

pub fn set_oracle(env: &Env, new_oracle: &Address) {
    env.storage().instance().set(&DataKey::Oracle, new_oracle);
}

pub fn ltv_bps(env: &Env) -> u32 {
    env.storage().instance().get(&DataKey::LtvBps).unwrap()
}

pub fn set_ltv_bps(env: &Env, new_ltv_bps: u32) {
    env.storage().instance().set(&DataKey::LtvBps, &new_ltv_bps);
}

pub fn liquidation_threshold_bps(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::LiquidationThresholdBps)
        .unwrap()
}

pub fn set_liquidation_threshold_bps(env: &Env, new_threshold_bps: u32) {
    env.storage()
        .instance()
        .set(&DataKey::LiquidationThresholdBps, &new_threshold_bps);
}

/// Allocates and returns the next loan id, bumping the counter.
pub fn next_loan_id(env: &Env) -> u64 {
    let id: u64 = env.storage().instance().get(&DataKey::NextLoanId).unwrap_or(0);
    env.storage().instance().set(&DataKey::NextLoanId, &(id + 1));
    id
}

pub fn get_loan(env: &Env, id: u64) -> Loan {
    env.storage()
        .persistent()
        .get(&DataKey::Loan(id))
        .unwrap_or_else(|| panic_with_error!(env, VaultError::LoanNotOpen))
}

pub fn set_loan(env: &Env, id: u64, loan: &Loan) {
    let key = DataKey::Loan(id);
    env.storage().persistent().set(&key, loan);
    env.storage()
        .persistent()
        .extend_ttl(&key, LOAN_LIFETIME_THRESHOLD, LOAN_BUMP_AMOUNT);
}

pub fn borrower_loans(env: &Env, borrower: &Address) -> Vec<u64> {
    env.storage()
        .persistent()
        .get(&DataKey::BorrowerLoans(borrower.clone()))
        .unwrap_or_else(|| Vec::new(env))
}

pub fn push_borrower_loan(env: &Env, borrower: &Address, id: u64) {
    let key = DataKey::BorrowerLoans(borrower.clone());
    let mut loans = borrower_loans(env, borrower);
    loans.push_back(id);
    env.storage().persistent().set(&key, &loans);
    env.storage()
        .persistent()
        .extend_ttl(&key, LOAN_LIFETIME_THRESHOLD, LOAN_BUMP_AMOUNT);
}
