use ankara_common::{
    asset::{self, AssetStatus},
    oracle::OracleClient,
    roles::{self, require_role, Role},
    verifier,
};
use soroban_sdk::{
    contract, contracterror, contractimpl, panic_with_error, symbol_short, token,
    token::TokenInterface, Address, BytesN, Env, String, Vec,
};

use crate::metadata::{self, MAX_TOKENS_PER_VAULT, PRICE_SCALE, YEAR_IN_SECONDS};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum PoolVaultError {
    TokenNotAccepted = 1,
    TokenAlreadyAccepted = 2,
    TooManyTokens = 3,
    BelowMinDeposit = 4,
    OracleNotSet = 5,
    OraclePriceStale = 6,
    ZeroAmount = 7,
    InsufficientPoolTokens = 8,
}

/// Direct port of `PoolVault.sol` — the vault itself is a fungible token
/// (pool shares) built on the same `common::fungible` SEP-41 base as the 6
/// ERC-20 templates, plus a multi-asset accepted-token registry, an
/// oracle-priced NAV, and management-fee accrual.
#[contract]
pub struct PoolVault;

#[contractimpl]
impl PoolVault {
    #[allow(clippy::too_many_arguments)]
    pub fn initialize(
        env: Env,
        name: String,
        symbol: String,
        asset_id: BytesN<32>,
        country_code: String,
        admin: Address,
        verifier: Option<Address>,
        fee_recipient: Option<Address>,
        oracle: Option<Address>,
        management_fee_bps: u32,
    ) {
        roles::init_roles(&env, &admin);
        asset::init_asset(&env, &asset_id, &country_code, &fee_recipient);
        ankara_common::fungible::init_metadata(&env, 18, name, symbol);
        ankara_common::verifier::init_identity_verifier(&env, &verifier);
        metadata::init_vault(&env, oracle, management_fee_bps);
    }

    // ─── Token registry (Role::Manager) ──────────────────────────────────

    pub fn add_accepted_token(env: Env, token: Address, weight_bps: u32) {
        require_role(&env, Role::Manager);
        if metadata::is_accepted(&env, &token) {
            panic_with_error!(&env, PoolVaultError::TokenAlreadyAccepted);
        }
        if metadata::accepted_tokens(&env).len() >= MAX_TOKENS_PER_VAULT {
            panic_with_error!(&env, PoolVaultError::TooManyTokens);
        }
        metadata::add_accepted_token(&env, token.clone(), weight_bps);
        env.events()
            .publish((symbol_short!("accepted"), token), weight_bps);
    }

    pub fn remove_accepted_token(env: Env, token: Address) {
        require_role(&env, Role::Manager);
        if !metadata::is_accepted(&env, &token) {
            panic_with_error!(&env, PoolVaultError::TokenNotAccepted);
        }
        metadata::remove_accepted_token(&env, &token);
        env.events().publish((symbol_short!("removed"),), token);
    }

    pub fn set_oracle(env: Env, oracle: Address) {
        require_role(&env, Role::Manager);
        metadata::set_oracle(&env, oracle.clone());
        env.events().publish((symbol_short!("oracle"),), oracle);
    }

    pub fn set_management_fee_bps(env: Env, new_fee_bps: u32) {
        require_role(&env, Role::Manager);
        metadata::set_management_fee_bps(&env, new_fee_bps);
    }

    pub fn set_min_deposit(env: Env, token: Address, min_amount: i128) {
        require_role(&env, Role::Manager);
        metadata::set_min_deposit(&env, token, min_amount);
    }

    // ─── Deposit / withdraw ───────────────────────────────────────────────

    /// Mirrors `deposit()` — pulls `amount` of `token_address` from
    /// `investor` (via a nested SEP-41 `transfer`, which requires
    /// `investor`'s own auth in the same call tree) and mints pool tokens
    /// priced at current NAV.
    pub fn deposit(env: Env, investor: Address, token_address: Address, amount: i128) {
        ankara_common::pausable::check_not_paused(&env);
        if !metadata::is_accepted(&env, &token_address) {
            panic_with_error!(&env, PoolVaultError::TokenNotAccepted);
        }
        if amount == 0 {
            panic_with_error!(&env, PoolVaultError::ZeroAmount);
        }
        let min_dep = metadata::min_deposit(&env, &token_address);
        if min_dep > 0 && amount < min_dep {
            panic_with_error!(&env, PoolVaultError::BelowMinDeposit);
        }
        let oracle_address = metadata::oracle(&env)
            .unwrap_or_else(|| panic_with_error!(&env, PoolVaultError::OracleNotSet));
        let oracle_client = OracleClient::new(&env, &oracle_address);
        if oracle_client.is_stale(&token_address) {
            panic_with_error!(&env, PoolVaultError::OraclePriceStale);
        }

        let pool_tokens_minted = Self::calculate_mint_amount(&env, &token_address, amount);

        token::TokenClient::new(&env, &token_address).transfer(
            &investor,
            &env.current_contract_address(),
            &amount,
        );
        ankara_common::fungible::mint(&env, &investor, pool_tokens_minted);

        env.events().publish(
            (symbol_short!("deposit"), investor, token_address),
            (amount, pool_tokens_minted),
        );
    }

    /// Mirrors `withdraw()` — computes the proportional basket against the
    /// pre-burn supply, burns first (re-entrancy protection, same ordering
    /// as the EVM version), then transfers each accepted token's share.
    pub fn withdraw(env: Env, investor: Address, pool_token_amount: i128) {
        ankara_common::pausable::check_not_paused(&env);
        if pool_token_amount == 0 {
            panic_with_error!(&env, PoolVaultError::ZeroAmount);
        }
        if ankara_common::fungible::balance(&env, &investor) < pool_token_amount {
            panic_with_error!(&env, PoolVaultError::InsufficientPoolTokens);
        }

        let supply_before = ankara_common::fungible::total_supply(&env);
        let tokens = metadata::accepted_tokens(&env);
        let mut amounts: Vec<i128> = Vec::new(&env);
        for token_address in tokens.iter() {
            let vault_balance =
                token::TokenClient::new(&env, &token_address).balance(&env.current_contract_address());
            let amount = (vault_balance * pool_token_amount) / supply_before;
            amounts.push_back(amount);
        }

        ankara_common::fungible::burn(&env, &investor, pool_token_amount);

        for i in 0..tokens.len() {
            let token_address = tokens.get(i).unwrap();
            let amount = amounts.get(i).unwrap();
            if amount > 0 {
                token::TokenClient::new(&env, &token_address).transfer(
                    &env.current_contract_address(),
                    &investor,
                    &amount,
                );
            }
        }

        env.events()
            .publish((symbol_short!("withdraw"), investor), (pool_token_amount, tokens, amounts));
    }

    /// Mirrors `accrueManagementFee()` — callable by anyone, mints the
    /// elapsed-time-prorated fee directly to `fee_recipient`.
    pub fn accrue_management_fee(env: Env) {
        let fee_bps = metadata::management_fee_bps(&env);
        if fee_bps == 0 {
            return;
        }
        let supply = ankara_common::fungible::total_supply(&env);
        if supply == 0 {
            return;
        }
        let last_accrual = metadata::last_fee_accrual(&env);
        let now = env.ledger().timestamp();
        let elapsed = now - last_accrual;
        if elapsed == 0 {
            return;
        }
        let fee_tokens =
            (supply * fee_bps as i128 * elapsed as i128) / (10_000 * YEAR_IN_SECONDS as i128);
        metadata::set_last_fee_accrual(&env, now);
        if fee_tokens > 0 {
            if let Some(recipient) = asset::fee_recipient(&env) {
                ankara_common::fungible::mint(&env, &recipient, fee_tokens);
                env.events()
                    .publish((symbol_short!("fee"),), (fee_tokens, now));
            }
        }
    }

    // ─── NAV / AUM ────────────────────────────────────────────────────────

    /// Mirrors `totalAUM()` — sum of `balance(token) * price(token) / 1e18`
    /// across accepted tokens; `0` when no oracle is configured.
    pub fn total_aum(env: Env) -> i128 {
        let oracle_address = match metadata::oracle(&env) {
            Some(o) => o,
            None => return 0,
        };
        let oracle_client = OracleClient::new(&env, &oracle_address);
        let mut aum: i128 = 0;
        for token_address in metadata::accepted_tokens(&env).iter() {
            let balance =
                token::TokenClient::new(&env, &token_address).balance(&env.current_contract_address());
            if balance == 0 {
                continue;
            }
            let (price, _) = oracle_client.get_price(&token_address);
            aum += (balance * price) / PRICE_SCALE;
        }
        aum
    }

    /// Mirrors `NAVPerToken()` — `1e18` ($1.00) when the pool is empty,
    /// bootstrapping the initial mint price.
    pub fn nav_per_token(env: Env) -> i128 {
        let supply = ankara_common::fungible::total_supply(&env);
        if supply == 0 {
            return PRICE_SCALE;
        }
        (Self::total_aum(env.clone()) * PRICE_SCALE) / supply
    }

    fn calculate_mint_amount(env: &Env, token_address: &Address, amount: i128) -> i128 {
        let oracle_address = metadata::oracle(env).unwrap();
        let oracle_client = OracleClient::new(env, &oracle_address);
        let (price, _) = oracle_client.get_price(token_address);
        let value_usd = (amount * price) / PRICE_SCALE;

        let supply = ankara_common::fungible::total_supply(env);
        if supply == 0 {
            return value_usd;
        }
        let nav = Self::nav_per_token(env.clone());
        (value_usd * PRICE_SCALE) / nav
    }

    // ─── Views ──────────────────────────────────────────────────────────

    pub fn total_supply(env: Env) -> i128 {
        ankara_common::fungible::total_supply(&env)
    }

    pub fn accepted_tokens(env: Env) -> Vec<Address> {
        metadata::accepted_tokens(&env)
    }

    pub fn is_accepted(env: Env, token: Address) -> bool {
        metadata::is_accepted(&env, &token)
    }

    pub fn token_weight(env: Env, token: Address) -> u32 {
        metadata::token_weight(&env, &token)
    }

    pub fn min_deposit(env: Env, token: Address) -> i128 {
        metadata::min_deposit(&env, &token)
    }

    pub fn oracle(env: Env) -> Option<Address> {
        metadata::oracle(&env)
    }

    pub fn management_fee_bps(env: Env) -> u32 {
        metadata::management_fee_bps(&env)
    }

    pub fn last_fee_accrual(env: Env) -> u64 {
        metadata::last_fee_accrual(&env)
    }

    pub fn asset_id(env: Env) -> BytesN<32> {
        asset::asset_id(&env)
    }

    pub fn country_code(env: Env) -> String {
        asset::country_code(&env)
    }

    pub fn status(env: Env) -> AssetStatus {
        asset::status(&env)
    }

    pub fn identity_verifier(env: Env) -> Option<Address> {
        verifier::identity_verifier(&env)
    }

    // ─── Status / verifier (Role::Manager) ───────────────────────────────

    pub fn set_status(env: Env, new_status: AssetStatus) {
        asset::set_status_gated(&env, new_status);
    }

    pub fn set_identity_verifier(env: Env, new_verifier: Option<Address>) {
        verifier::set_identity_verifier(&env, &new_verifier);
    }

    // ─── Minting (Role::Minter) — direct pool-token issuance, distinct
    // from deposit-triggered minting ──────────────────────────────────────

    pub fn mint(env: Env, to: Address, amount: i128) {
        require_role(&env, Role::Minter);
        verifier::check_verified(&env, &to);
        ankara_common::fungible::mint(&env, &to, amount);
    }

    // ─── Pause (Role::Pauser) ─────────────────────────────────────────────

    pub fn pause(env: Env) {
        ankara_common::pausable::pause(&env);
    }

    pub fn unpause(env: Env) {
        ankara_common::pausable::unpause(&env);
    }

    pub fn is_paused(env: Env) -> bool {
        ankara_common::pausable::is_paused(&env)
    }

    // ─── Upgrade (Role::Upgrader) ────────────────────────────────────────

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        require_role(&env, Role::Upgrader);
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }
}

#[contractimpl]
impl TokenInterface for PoolVault {
    fn allowance(env: Env, from: Address, spender: Address) -> i128 {
        ankara_common::fungible::allowance(&env, &from, &spender)
    }

    fn approve(env: Env, from: Address, spender: Address, amount: i128, expiration_ledger: u32) {
        ankara_common::fungible::approve(&env, &from, &spender, amount, expiration_ledger);
    }

    fn balance(env: Env, id: Address) -> i128 {
        ankara_common::fungible::balance(&env, &id)
    }

    fn transfer(env: Env, from: Address, to: soroban_sdk::MuxedAddress, amount: i128) {
        let to_address = to.address();
        verifier::check_verified(&env, &from);
        verifier::check_verified(&env, &to_address);
        ankara_common::fungible::transfer(&env, &from, &to_address, amount);
    }

    fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        verifier::check_verified(&env, &from);
        verifier::check_verified(&env, &to);
        ankara_common::fungible::transfer_from(&env, &spender, &from, &to, amount);
    }

    fn burn(env: Env, from: Address, amount: i128) {
        ankara_common::fungible::burn(&env, &from, amount);
    }

    fn burn_from(env: Env, spender: Address, from: Address, amount: i128) {
        ankara_common::fungible::burn_from(&env, &spender, &from, amount);
    }

    fn decimals(env: Env) -> u32 {
        ankara_common::fungible::decimals(&env)
    }

    fn name(env: Env) -> String {
        ankara_common::fungible::name(&env)
    }

    fn symbol(env: Env) -> String {
        ankara_common::fungible::symbol(&env)
    }
}
