use ankara_common::{
    asset,
    roles::{self, require_role, Role},
    verifier, AssetStatus,
};
use soroban_sdk::{
    contract, contractimpl, panic_with_error, symbol_short, token::TokenInterface, Address,
    BytesN, Env, String,
};

use crate::metadata::{self, CarbonCreditMetadata, RetirementRecord};

#[soroban_sdk::contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum CarbonCreditError {
    ZeroRetirementAmount = 1,
    InsufficientBalance = 2,
}

#[contract]
pub struct CarbonCreditToken;

#[contractimpl]
impl CarbonCreditToken {
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
        carbon_metadata: CarbonCreditMetadata,
    ) {
        roles::init_roles(&env, &admin);
        asset::init_asset(&env, &asset_id, &country_code, &fee_recipient);
        ankara_common::fungible::init_metadata(&env, 18, name, symbol);
        ankara_common::verifier::init_identity_verifier(&env, &verifier);
        metadata::init_metadata(&env, carbon_metadata);
    }

    // ─── Reads ──────────────────────────────────────────────────────────

    pub fn get_metadata(env: Env) -> CarbonCreditMetadata {
        metadata::get_metadata(&env)
    }

    pub fn total_supply(env: Env) -> i128 {
        ankara_common::fungible::total_supply(&env)
    }

    pub fn credit_type(env: Env) -> String {
        metadata::get_metadata(&env).credit_type
    }

    pub fn vintage_year(env: Env) -> u32 {
        metadata::get_metadata(&env).vintage_year
    }

    pub fn quantity_co2e(env: Env) -> i128 {
        metadata::get_metadata(&env).quantity_co2e
    }

    pub fn get_retirement(env: Env, index: u32) -> RetirementRecord {
        metadata::get_retirement(&env, index)
    }

    pub fn total_retirements(env: Env) -> u32 {
        metadata::total_retirements(&env)
    }

    pub fn total_retired(env: Env) -> i128 {
        metadata::total_retired(&env)
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

    pub fn metadata_version(env: Env) -> u32 {
        asset::metadata_version(&env)
    }

    pub fn identity_verifier(env: Env) -> Option<Address> {
        verifier::identity_verifier(&env)
    }

    // ─── Retire credits — any holder, no role gate ──────────────────────

    /// Mirrors `retire()` — permanently burns the caller's own credits and
    /// records an on-chain retirement proof. Irreversible, matching the
    /// EVM `@dev Retirement is IRREVERSIBLE` comment. Any holder can retire
    /// their own credits (no `MANAGER_ROLE`/`MINTER_ROLE` gate), same as
    /// Solidity's `retire()` being open to `msg.sender`.
    pub fn retire(env: Env, retired_by: Address, amount: i128, beneficiary: String, note: String) {
        if amount == 0 {
            panic_with_error!(&env, CarbonCreditError::ZeroRetirementAmount);
        }
        let balance = ankara_common::fungible::balance(&env, &retired_by);
        if balance < amount {
            panic_with_error!(&env, CarbonCreditError::InsufficientBalance);
        }
        ankara_common::fungible::burn(&env, &retired_by, amount);
        let index =
            metadata::record_retirement(&env, retired_by.clone(), amount, beneficiary.clone(), note);
        env.events().publish(
            (symbol_short!("retired"), retired_by),
            (amount, beneficiary, index, env.ledger().timestamp()),
        );
    }

    // ─── Writes (Role::Manager) ─────────────────────────────────────────

    pub fn update_metadata(env: Env, carbon_metadata: CarbonCreditMetadata) {
        require_role(&env, Role::Manager);
        metadata::update_metadata(&env, carbon_metadata);
        asset::bump_metadata_version(&env);
    }

    pub fn set_status(env: Env, new_status: AssetStatus) {
        asset::set_status_gated(&env, new_status);
    }

    pub fn set_identity_verifier(env: Env, new_verifier: Option<Address>) {
        verifier::set_identity_verifier(&env, &new_verifier);
    }

    // ─── Compliance policy (opt-in freeze / clawback / transfer rules) ──

    pub fn set_compliance_policy(env: Env, new_policy: Option<Address>) {
        ankara_common::compliance::set_compliance_policy(&env, &new_policy);
    }

    pub fn compliance_policy(env: Env) -> Option<Address> {
        ankara_common::compliance::compliance_policy(&env)
    }

    /// Callable only by the attached compliance-policy contract. `to = None`
    /// burns the clawed-back amount.
    pub fn clawback(env: Env, from: Address, amount: i128, to: Option<Address>) {
        ankara_common::compliance::clawback(&env, &from, amount, &to);
    }

    pub fn link_to_nft(env: Env, nft_address: Address) {
        asset::link_nft(&env, &nft_address);
    }

    // ─── Minting (Role::Minter) ──────────────────────────────────────────

    pub fn mint(env: Env, to: Address, amount: i128) {
        require_role(&env, Role::Minter);
        verifier::check_verified(&env, &to);
        ankara_common::fungible::mint(&env, &to, amount);
    }

    // ─── Upgrade (Role::Upgrader) ────────────────────────────────────────

    // ─── Pause (Role::Pauser) ────────────────────────────────────────────

    pub fn pause(env: Env) {
        ankara_common::pausable::pause(&env);
    }

    pub fn unpause(env: Env) {
        ankara_common::pausable::unpause(&env);
    }

    pub fn is_paused(env: Env) -> bool {
        ankara_common::pausable::is_paused(&env)
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        require_role(&env, Role::Upgrader);
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }
}

#[contractimpl]
impl TokenInterface for CarbonCreditToken {
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
