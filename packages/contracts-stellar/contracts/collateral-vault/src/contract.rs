use ankara_common::{
    oracle::OracleClient,
    roles::{self, require_role, Role},
};
use soroban_sdk::{contract, contractimpl, panic_with_error, symbol_short, token, Address, Env, Vec};

use crate::credit::{self, CreditScoreClient, ScoreConfig, ScoredTerms};
use crate::errors::VaultError;
use crate::loan::{self, Loan, LoanStatus};

/// Prices from `ankara_common::oracle::OracleClient` are USD with 18-decimal
/// precision (1e18 = $1.00), the same convention `IAnkaraOracle.sol`/
/// `ManualOracle.sol` document on the EVM side — `manual-oracle` is a direct
/// port of that contract and inherits its scale.
const PRICE_SCALE: i128 = 1_000_000_000_000_000_000;
const BPS_DENOMINATOR: u32 = 10_000;

/// Singleton lending pool (one instance per network, like `ramp-settlement`
/// — not deployed per-relationship like `milestone-escrow`). Any Ankara RWA
/// token can be pledged as collateral to borrow a single configured asset
/// (e.g. USDC). v1 scope is intentionally minimal: a single trusted-poster
/// oracle (see `PRICE_SCALE` above), no interest accrual (the vault pays out
/// borrowed funds from its own pre-seeded balance), and undercollateralization
/// -only liquidation (no loan maturity/due date — see `loan::LoanStatus`).
#[contract]
pub struct CollateralVault;

#[contractimpl]
impl CollateralVault {
    pub fn initialize(
        env: Env,
        admin: Address,
        borrowed_token: Address,
        oracle: Address,
        ltv_bps: u32,
        liquidation_threshold_bps: u32,
    ) {
        if ltv_bps == 0 || ltv_bps >= liquidation_threshold_bps || liquidation_threshold_bps >= BPS_DENOMINATOR {
            panic_with_error!(&env, VaultError::InvalidConfig);
        }
        roles::init_roles(&env, &admin);
        loan::init_config(&env, borrowed_token, oracle, ltv_bps, liquidation_threshold_bps);
    }

    // ─── Borrower lifecycle ───────────────────────────────────────────────

    /// Pledges `collateral_amount` of `collateral_token` and borrows up to
    /// the vault's configured LTV against its live oracle price. The vault
    /// must already hold enough `borrowed_token` to pay out — there is no
    /// separate lending-pool/interest-accrual mechanism in v1, it's simply
    /// pre-seeded by the admin.
    pub fn open_loan(
        env: Env,
        caller: Address,
        collateral_token: Address,
        collateral_amount: i128,
        borrow_amount: i128,
    ) -> u64 {
        caller.require_auth();
        ankara_common::pausable::check_not_paused(&env);
        if collateral_amount <= 0 || borrow_amount <= 0 {
            panic_with_error!(&env, VaultError::ZeroAmount);
        }

        let oracle_addr = loan::oracle(&env);
        let oracle_client = OracleClient::new(&env, &oracle_addr);
        if oracle_client.is_stale(&collateral_token) {
            panic_with_error!(&env, VaultError::StaleOraclePrice);
        }
        let (price, _timestamp) = oracle_client.get_price(&collateral_token);
        if price <= 0 {
            panic_with_error!(&env, VaultError::StaleOraclePrice);
        }

        let current_ltv_bps = loan::ltv_bps(&env);
        let collateral_value_usd = collateral_amount * price / PRICE_SCALE;
        let max_borrowable = collateral_value_usd * (current_ltv_bps as i128) / (BPS_DENOMINATOR as i128);
        if borrow_amount > max_borrowable {
            panic_with_error!(&env, VaultError::ExceedsLtv);
        }

        let borrowed_token = loan::borrowed_token(&env);
        let loan_id = loan::next_loan_id(&env);

        // Effects before interaction.
        let record = Loan {
            borrower: caller.clone(),
            collateral_token: collateral_token.clone(),
            collateral_amount,
            borrowed_token: borrowed_token.clone(),
            borrowed_amount: borrow_amount,
            ltv_bps: current_ltv_bps,
            opened_at: env.ledger().timestamp(),
            status: LoanStatus::Open,
        };
        loan::set_loan(&env, loan_id, &record);
        loan::push_borrower_loan(&env, &caller, loan_id);

        token::TokenClient::new(&env, &collateral_token).transfer(
            &caller,
            &env.current_contract_address(),
            &collateral_amount,
        );
        token::TokenClient::new(&env, &borrowed_token).transfer(
            &env.current_contract_address(),
            &caller,
            &borrow_amount,
        );

        env.events()
            .publish((symbol_short!("opened"), loan_id), (collateral_amount, borrow_amount));
        loan_id
    }

    // ─── Score-based (undercollateralized) lending ─────────────────────────

    /// Opens a loan sized against the borrower's credit score from the
    /// configured score source, instead of only against collateral:
    ///
    /// `limit = tier.credit_limit + collateral_value * ltv_bps / 10_000`
    ///
    /// Collateral is optional (`collateral_token = None` for a fully
    /// unsecured loan). The loan must be repaid — principal plus the tier's
    /// flat fee — by `now + term_secs`; after that anyone can
    /// `mark_defaulted` it (collateral, if any, goes to the Manager). Scored
    /// loans are never price-liquidated: their risk is the score, not the
    /// collateral's price.
    pub fn open_scored_loan(
        env: Env,
        caller: Address,
        collateral_token: Option<Address>,
        collateral_amount: i128,
        borrow_amount: i128,
        term_secs: u64,
    ) -> u64 {
        caller.require_auth();
        ankara_common::pausable::check_not_paused(&env);
        if borrow_amount <= 0 || collateral_amount < 0 {
            panic_with_error!(&env, VaultError::ZeroAmount);
        }
        let cfg = credit::config(&env)
            .unwrap_or_else(|| panic_with_error!(&env, VaultError::NoScoreSource));
        let score = CreditScoreClient::new(&env, &cfg.source)
            .credit_score(&caller)
            .unwrap_or_else(|| panic_with_error!(&env, VaultError::NoScore));
        let now = env.ledger().timestamp();
        if now.saturating_sub(score.updated_at) > cfg.max_score_age {
            panic_with_error!(&env, VaultError::StaleScore);
        }
        let tier = credit::tier_for(&cfg, score.score)
            .unwrap_or_else(|| panic_with_error!(&env, VaultError::ScoreTooLow));
        if term_secs == 0 || term_secs > tier.max_term_secs {
            panic_with_error!(&env, VaultError::InvalidTerm);
        }

        let borrowed_token = loan::borrowed_token(&env);
        let (collateral_addr, secured_allowance) = match &collateral_token {
            Some(token_addr) if collateral_amount > 0 => {
                let value = collateral_value_usd(&env, token_addr, collateral_amount);
                (
                    token_addr.clone(),
                    value * (loan::ltv_bps(&env) as i128) / (BPS_DENOMINATOR as i128),
                )
            }
            // No collateral: record the borrowed token as a placeholder
            // with a zero amount (nothing is transferred for it).
            _ => (borrowed_token.clone(), 0),
        };
        let pledged = if secured_allowance > 0 { collateral_amount } else { 0 };
        if borrow_amount > tier.credit_limit + secured_allowance {
            panic_with_error!(&env, VaultError::ExceedsCreditLimit);
        }

        let loan_id = loan::next_loan_id(&env);
        let record = Loan {
            borrower: caller.clone(),
            collateral_token: collateral_addr.clone(),
            collateral_amount: pledged,
            borrowed_token: borrowed_token.clone(),
            borrowed_amount: borrow_amount,
            ltv_bps: loan::ltv_bps(&env),
            opened_at: now,
            status: LoanStatus::Open,
        };
        loan::set_loan(&env, loan_id, &record);
        loan::push_borrower_loan(&env, &caller, loan_id);
        credit::set_terms(
            &env,
            loan_id,
            &ScoredTerms {
                score: score.score,
                unsecured_amount: (borrow_amount - secured_allowance).max(0),
                fee_bps: tier.fee_bps,
                due_at: now + term_secs,
            },
        );

        if pledged > 0 {
            token::TokenClient::new(&env, &collateral_addr).transfer(
                &caller,
                &env.current_contract_address(),
                &pledged,
            );
        }
        token::TokenClient::new(&env, &borrowed_token).transfer(
            &env.current_contract_address(),
            &caller,
            &borrow_amount,
        );
        env.events().publish(
            (symbol_short!("scored"), loan_id),
            (caller, score.score, borrow_amount, pledged),
        );
        loan_id
    }

    /// Callable by anyone once a score-based loan is past due and unpaid.
    /// Any pledged collateral goes to the Manager. The `defaulted` event is
    /// what score sources should watch to update the borrower's record.
    pub fn mark_defaulted(env: Env, loan_id: u64) {
        let mut record = loan::get_loan(&env, loan_id);
        if record.status != LoanStatus::Open {
            panic_with_error!(&env, VaultError::LoanNotOpen);
        }
        let terms = credit::terms(&env, loan_id)
            .unwrap_or_else(|| panic_with_error!(&env, VaultError::NotDue));
        if env.ledger().timestamp() <= terms.due_at {
            panic_with_error!(&env, VaultError::NotDue);
        }
        record.status = LoanStatus::Defaulted;
        loan::set_loan(&env, loan_id, &record);
        if record.collateral_amount > 0 {
            token::TokenClient::new(&env, &record.collateral_token).transfer(
                &env.current_contract_address(),
                &roles::get_role(&env, Role::Manager),
                &record.collateral_amount,
            );
        }
        env.events().publish(
            (symbol_short!("defaulted"), loan_id),
            (record.borrower, record.borrowed_amount),
        );
    }

    /// Repays the full borrowed amount (plus the tier fee, for score-based
    /// loans) and releases the collateral back to the borrower.
    pub fn repay_loan(env: Env, caller: Address, loan_id: u64) {
        caller.require_auth();
        ankara_common::pausable::check_not_paused(&env);
        let mut record = loan::get_loan(&env, loan_id);
        if record.status != LoanStatus::Open {
            panic_with_error!(&env, VaultError::LoanNotOpen);
        }
        if caller != record.borrower {
            panic_with_error!(&env, VaultError::NotBorrower);
        }

        record.status = LoanStatus::Repaid;
        let (collateral_token, collateral_amount, borrowed_token, borrowed_amount) = (
            record.collateral_token.clone(),
            record.collateral_amount,
            record.borrowed_token.clone(),
            record.borrowed_amount,
        );
        loan::set_loan(&env, loan_id, &record);
        let due = borrowed_amount + fee_for(&env, loan_id, borrowed_amount);

        token::TokenClient::new(&env, &borrowed_token).transfer(
            &caller,
            &env.current_contract_address(),
            &due,
        );
        if collateral_amount > 0 {
            token::TokenClient::new(&env, &collateral_token).transfer(
                &env.current_contract_address(),
                &caller,
                &collateral_amount,
            );
        }

        env.events().publish((symbol_short!("repaid"), loan_id), due);
    }

    /// Callable by anyone once a loan's live oracle-priced LTV has crossed
    /// the liquidation threshold — mirrors `claim_timelock_release`'s
    /// "anyone can call once eligible" pattern in `milestone-escrow`.
    /// Liquidated collateral goes to the `Role::Manager` address; v1 has no
    /// dedicated liquidator-recipient setter, reusing Manager keeps this
    /// simple (see plan notes for the rationale).
    pub fn liquidate(env: Env, loan_id: u64) {
        ankara_common::pausable::check_not_paused(&env);
        let mut record = loan::get_loan(&env, loan_id);
        if record.status != LoanStatus::Open {
            panic_with_error!(&env, VaultError::LoanNotOpen);
        }
        if !Self::is_liquidatable(env.clone(), loan_id) {
            panic_with_error!(&env, VaultError::NotLiquidatable);
        }

        record.status = LoanStatus::Liquidated;
        let (collateral_token, collateral_amount) =
            (record.collateral_token.clone(), record.collateral_amount);
        loan::set_loan(&env, loan_id, &record);

        let recipient = roles::get_role(&env, Role::Manager);
        token::TokenClient::new(&env, &collateral_token).transfer(
            &env.current_contract_address(),
            &recipient,
            &collateral_amount,
        );

        env.events()
            .publish((symbol_short!("liquidat"), loan_id), collateral_amount);
    }

    // ─── Admin (Role::Manager) ────────────────────────────────────────────

    pub fn set_ltv_bps(env: Env, new_ltv_bps: u32) {
        require_role(&env, Role::Manager);
        if new_ltv_bps == 0 || new_ltv_bps >= loan::liquidation_threshold_bps(&env) {
            panic_with_error!(&env, VaultError::InvalidConfig);
        }
        loan::set_ltv_bps(&env, new_ltv_bps);
        env.events().publish((symbol_short!("ltv"),), new_ltv_bps);
    }

    pub fn set_liquidation_threshold_bps(env: Env, new_threshold_bps: u32) {
        require_role(&env, Role::Manager);
        if new_threshold_bps <= loan::ltv_bps(&env) || new_threshold_bps >= BPS_DENOMINATOR {
            panic_with_error!(&env, VaultError::InvalidConfig);
        }
        loan::set_liquidation_threshold_bps(&env, new_threshold_bps);
        env.events().publish((symbol_short!("liqthresh"),), new_threshold_bps);
    }

    /// Configures (or with `None`, disables) score-based lending. Tiers must
    /// be strictly ascending by `min_score`, with non-negative limits.
    pub fn set_score_config(env: Env, config: Option<ScoreConfig>) {
        require_role(&env, Role::Manager);
        if let Some(cfg) = &config {
            if cfg.tiers.is_empty() {
                panic_with_error!(&env, VaultError::InvalidConfig);
            }
            let mut prev: Option<u32> = None;
            for t in cfg.tiers.iter() {
                if t.credit_limit < 0 || t.fee_bps > BPS_DENOMINATOR || t.max_term_secs == 0 {
                    panic_with_error!(&env, VaultError::InvalidConfig);
                }
                if let Some(p) = prev {
                    if t.min_score <= p {
                        panic_with_error!(&env, VaultError::InvalidConfig);
                    }
                }
                prev = Some(t.min_score);
            }
        }
        credit::set_config(&env, &config);
        env.events().publish((symbol_short!("scorecfg"),), config.is_some());
    }

    pub fn set_oracle(env: Env, new_oracle: Address) {
        require_role(&env, Role::Manager);
        loan::set_oracle(&env, &new_oracle);
        env.events().publish((symbol_short!("oracle"),), new_oracle);
    }

    pub fn pause(env: Env) {
        ankara_common::pausable::pause(&env);
    }

    pub fn unpause(env: Env) {
        ankara_common::pausable::unpause(&env);
    }

    pub fn is_paused(env: Env) -> bool {
        ankara_common::pausable::is_paused(&env)
    }

    // ─── Views ────────────────────────────────────────────────────────────

    pub fn borrowed_token(env: Env) -> Address {
        loan::borrowed_token(&env)
    }

    pub fn oracle(env: Env) -> Address {
        loan::oracle(&env)
    }

    pub fn ltv_bps(env: Env) -> u32 {
        loan::ltv_bps(&env)
    }

    pub fn liquidation_threshold_bps(env: Env) -> u32 {
        loan::liquidation_threshold_bps(&env)
    }

    pub fn get_loan(env: Env, loan_id: u64) -> Loan {
        loan::get_loan(&env, loan_id)
    }

    pub fn get_borrower_loans(env: Env, borrower: Address) -> Vec<u64> {
        loan::borrower_loans(&env, &borrower)
    }

    /// Live, oracle-priced current LTV of an open loan, in bps. Not the same
    /// as the loan's locked-in `ltv_bps` (the LTV at open time) — this one
    /// moves with the collateral's live price.
    pub fn current_ltv_bps(env: Env, loan_id: u64) -> u32 {
        let record = loan::get_loan(&env, loan_id);
        let oracle_addr = loan::oracle(&env);
        let oracle_client = OracleClient::new(&env, &oracle_addr);
        let (price, _timestamp) = oracle_client.get_price(&record.collateral_token);
        if price <= 0 {
            return u32::MAX;
        }
        let collateral_value_usd = record.collateral_amount * price / PRICE_SCALE;
        if collateral_value_usd == 0 {
            return u32::MAX;
        }
        (record.borrowed_amount * (BPS_DENOMINATOR as i128) / collateral_value_usd) as u32
    }

    pub fn score_config(env: Env) -> Option<ScoreConfig> {
        credit::config(&env)
    }

    /// `None` for ordinary collateral-only loans.
    pub fn get_scored_terms(env: Env, loan_id: u64) -> Option<ScoredTerms> {
        credit::terms(&env, loan_id)
    }

    /// Principal plus fee owed to close the loan now.
    pub fn amount_due(env: Env, loan_id: u64) -> i128 {
        let record = loan::get_loan(&env, loan_id);
        record.borrowed_amount + fee_for(&env, loan_id, record.borrowed_amount)
    }

    /// What `borrower` could open with `open_scored_loan` right now, given
    /// optional collateral — `0` if they don't qualify.
    pub fn scored_borrow_limit(
        env: Env,
        borrower: Address,
        collateral_token: Option<Address>,
        collateral_amount: i128,
    ) -> i128 {
        let cfg = match credit::config(&env) {
            Some(c) => c,
            None => return 0,
        };
        let score = match CreditScoreClient::new(&env, &cfg.source).credit_score(&borrower) {
            Some(s) => s,
            None => return 0,
        };
        if env.ledger().timestamp().saturating_sub(score.updated_at) > cfg.max_score_age {
            return 0;
        }
        let tier = match credit::tier_for(&cfg, score.score) {
            Some(t) => t,
            None => return 0,
        };
        let secured = match collateral_token {
            Some(t) if collateral_amount > 0 => {
                collateral_value_usd(&env, &t, collateral_amount) * (loan::ltv_bps(&env) as i128)
                    / (BPS_DENOMINATOR as i128)
            }
            _ => 0,
        };
        tier.credit_limit + secured
    }

    /// Score-based loans are never price-liquidated (see `open_scored_loan`).
    pub fn is_liquidatable(env: Env, loan_id: u64) -> bool {
        let record = loan::get_loan(&env, loan_id);
        if record.status != LoanStatus::Open || credit::terms(&env, loan_id).is_some() {
            return false;
        }
        Self::current_ltv_bps(env.clone(), loan_id) >= loan::liquidation_threshold_bps(&env)
    }

    // ─── Upgrade (Role::Upgrader) ────────────────────────────────────────

    pub fn upgrade(env: Env, new_wasm_hash: soroban_sdk::BytesN<32>) {
        require_role(&env, Role::Upgrader);
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }
}

/// Oracle-priced USD value of `amount` of `token`; panics on a stale or
/// missing price, same checks as `open_loan`.
fn collateral_value_usd(env: &Env, token_addr: &Address, amount: i128) -> i128 {
    let oracle_client = OracleClient::new(env, &loan::oracle(env));
    if oracle_client.is_stale(token_addr) {
        panic_with_error!(env, VaultError::StaleOraclePrice);
    }
    let (price, _) = oracle_client.get_price(token_addr);
    if price <= 0 {
        panic_with_error!(env, VaultError::StaleOraclePrice);
    }
    amount * price / PRICE_SCALE
}

fn fee_for(env: &Env, loan_id: u64, principal: i128) -> i128 {
    match credit::terms(env, loan_id) {
        Some(t) => principal * (t.fee_bps as i128) / (BPS_DENOMINATOR as i128),
        None => 0,
    }
}
