use ankara_common::{
    asset,
    roles::{self, require_role, Role},
    verifier, AssetStatus,
};
use soroban_sdk::{contract, contractimpl, token::TokenInterface, Address, BytesN, Env, String};

use crate::metadata::{self, CommodityMetadata};

#[contract]
pub struct CommodityReceiptToken;

#[contractimpl]
impl CommodityReceiptToken {
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
        commodity_metadata: CommodityMetadata,
    ) {
        roles::init_roles(&env, &admin);
        asset::init_asset(&env, &asset_id, &country_code, &fee_recipient);
        ankara_common::fungible::init_metadata(&env, 18, name, symbol);
        ankara_common::verifier::init_identity_verifier(&env, &verifier);
        metadata::init_metadata(&env, commodity_metadata);
    }

    // ─── Reads ──────────────────────────────────────────────────────────

    pub fn get_metadata(env: Env) -> CommodityMetadata {
        metadata::get_metadata(&env)
    }

    pub fn total_supply(env: Env) -> i128 {
        ankara_common::fungible::total_supply(&env)
    }

    pub fn is_expired(env: Env) -> bool {
        metadata::is_expired(&env)
    }

    pub fn commodity_type(env: Env) -> String {
        metadata::get_metadata(&env).commodity_type
    }

    pub fn quantity_kg(env: Env) -> i128 {
        metadata::get_metadata(&env).quantity_kg
    }

    pub fn valuation_usd(env: Env) -> i128 {
        metadata::get_metadata(&env).valuation_usd
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

    // ─── Writes (Role::Manager) ─────────────────────────────────────────

    pub fn update_metadata(env: Env, commodity_metadata: CommodityMetadata) {
        require_role(&env, Role::Manager);
        metadata::update_metadata(&env, commodity_metadata);
        asset::bump_metadata_version(&env);
    }

    /// Mirrors `markExpired()` [MANAGER_ROLE] — sets status to `Expired`.
    pub fn mark_expired(env: Env) {
        require_role(&env, Role::Manager);
        asset::set_status(&env, AssetStatus::Expired);
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
impl TokenInterface for CommodityReceiptToken {
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
