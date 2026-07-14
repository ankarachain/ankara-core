use ankara_common::{
    oracle::OracleClient,
    roles::{self, require_role, Role},
};
use soroban_sdk::{contract, contractimpl, panic_with_error, symbol_short, token, Address, Env, Vec};

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

    /// Repays the full borrowed amount and releases the collateral back to
    /// the borrower.
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

        token::TokenClient::new(&env, &borrowed_token).transfer(
            &caller,
            &env.current_contract_address(),
            &borrowed_amount,
        );
        token::TokenClient::new(&env, &collateral_token).transfer(
            &env.current_contract_address(),
            &caller,
            &collateral_amount,
        );

        env.events().publish((symbol_short!("repaid"), loan_id), borrowed_amount);
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

    pub fn is_liquidatable(env: Env, loan_id: u64) -> bool {
        let record = loan::get_loan(&env, loan_id);
        if record.status != LoanStatus::Open {
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
