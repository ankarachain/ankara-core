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
    RegistryRefAlreadySet = 3,
    RetirementNotFound = 4,
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
        retire_inner(&env, retired_by, amount, beneficiary, note, None);
    }

    /// Same as `retire`, recording the independent verification body's
    /// reference (e.g. a Verra retirement serial) in the retirement record.
    pub fn retire_with_registry_ref(
        env: Env,
        retired_by: Address,
        amount: i128,
        beneficiary: String,
        note: String,
        external_registry_id: String,
    ) {
        retire_inner(&env, retired_by, amount, beneficiary, note, Some(external_registry_id));
    }

    /// Attaches the external registry ID to a past retirement (Manager,
    /// write-once).
    pub fn set_retirement_registry_ref(env: Env, index: u32, external_registry_id: String) {
        require_role(&env, Role::Manager);
        if index >= metadata::total_retirements(&env) {
            panic_with_error!(&env, CarbonCreditError::RetirementNotFound);
        }
        if !metadata::set_external_registry_id(&env, index, external_registry_id.clone()) {
            panic_with_error!(&env, CarbonCreditError::RegistryRefAlreadySet);
        }
        env.events()
            .publish((symbol_short!("reg_ref"), index), external_registry_id);
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

    // ─── Snapshots (Role::Manager) — pro-rata distributions ─────────────

    /// Records a balance snapshot and returns its id. Used by
    /// `revenue-distributor` to pay income out pro-rata to holders.
    pub fn snapshot(env: Env) -> u32 {
        require_role(&env, Role::Manager);
        ankara_common::fungible::snapshot(&env)
    }

    pub fn current_snapshot_id(env: Env) -> u32 {
        ankara_common::fungible::current_snapshot_id(&env)
    }

    pub fn balance_of_at(env: Env, id: Address, snapshot_id: u32) -> i128 {
        ankara_common::fungible::balance_of_at(&env, &id, snapshot_id)
    }

    pub fn total_supply_at(env: Env, snapshot_id: u32) -> i128 {
        ankara_common::fungible::total_supply_at(&env, snapshot_id)
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

/// Shared body of `retire`/`retire_with_registry_ref`.
fn retire_inner(
    env: &Env,
    retired_by: Address,
    amount: i128,
    beneficiary: String,
    note: String,
    external_registry_id: Option<String>,
) {
    if amount == 0 {
        panic_with_error!(env, CarbonCreditError::ZeroRetirementAmount);
    }
    let balance = ankara_common::fungible::balance(env, &retired_by);
    if balance < amount {
        panic_with_error!(env, CarbonCreditError::InsufficientBalance);
    }
    ankara_common::fungible::burn(env, &retired_by, amount);
    let index = metadata::record_retirement(
        env,
        retired_by.clone(),
        amount,
        beneficiary.clone(),
        note,
        external_registry_id,
    );
    env.events().publish(
        (symbol_short!("retired"), retired_by),
        (amount, beneficiary, index, env.ledger().timestamp()),
    );
}
