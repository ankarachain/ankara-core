use ankara_common::{
    asset,
    roles::{self, require_role, Role},
    verifier, AssetStatus,
};
use soroban_sdk::{
    contract, contractimpl, panic_with_error, symbol_short, token::TokenInterface, Address,
    BytesN, Env, String,
};

use crate::metadata::{self, MiningRightsMetadata};

#[soroban_sdk::contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum MiningRightsError {
    NoTokensInCirculation = 1,
    LicenseAlreadyExpired = 2,
}

#[contract]
pub struct MiningRightsToken;

#[contractimpl]
impl MiningRightsToken {
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
        mining_metadata: MiningRightsMetadata,
    ) {
        roles::init_roles(&env, &admin);
        asset::init_asset(&env, &asset_id, &country_code, &fee_recipient);
        ankara_common::fungible::init_metadata(&env, 18, name, symbol);
        ankara_common::verifier::init_identity_verifier(&env, &verifier);
        metadata::init_metadata(&env, mining_metadata);
    }

    // ─── Reads ──────────────────────────────────────────────────────────

    pub fn get_metadata(env: Env) -> MiningRightsMetadata {
        metadata::get_metadata(&env)
    }

    pub fn total_supply(env: Env) -> i128 {
        ankara_common::fungible::total_supply(&env)
    }

    pub fn is_license_expired(env: Env) -> bool {
        metadata::is_license_expired(&env)
    }

    pub fn days_until_expiry(env: Env) -> i64 {
        metadata::days_until_expiry(&env)
    }

    pub fn mineral_type(env: Env) -> String {
        metadata::get_metadata(&env).mineral_type
    }

    pub fn royalty_rate_bps(env: Env) -> u32 {
        metadata::get_metadata(&env).royalty_rate_bps
    }

    pub fn area_hectares(env: Env) -> i128 {
        metadata::get_metadata(&env).area_hectares
    }

    pub fn total_royalties_declared(env: Env) -> i128 {
        metadata::total_royalties_declared(&env)
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

    pub fn update_metadata(env: Env, mining_metadata: MiningRightsMetadata) {
        require_role(&env, Role::Manager);
        metadata::update_metadata(&env, mining_metadata);
        asset::bump_metadata_version(&env);
    }

    /// Mirrors `declareRoyalty()` — on-chain record only, actual payment
    /// distribution happens off-chain or via a separate contract.
    pub fn declare_royalty(env: Env, extraction_value_usd: i128) {
        require_role(&env, Role::Manager);
        let supply = ankara_common::fungible::total_supply(&env);
        if supply == 0 {
            panic_with_error!(&env, MiningRightsError::NoTokensInCirculation);
        }
        let (royalty_amount, per_token) =
            metadata::declare_royalty(&env, extraction_value_usd, supply);
        env.events().publish(
            (symbol_short!("royalty"),),
            (
                extraction_value_usd,
                royalty_amount,
                per_token,
                env.ledger().timestamp(),
            ),
        );
    }

    pub fn renew_license(env: Env, new_expiry: u64) {
        require_role(&env, Role::Manager);
        let old = metadata::renew_license(&env, new_expiry);
        asset::bump_metadata_version(&env);
        env.events().publish(
            (symbol_short!("renewed"),),
            (old, new_expiry, env.ledger().timestamp()),
        );
    }

    /// Mirrors `markLicenseExpired()` — only succeeds once the license has
    /// actually expired, matching the EVM guard
    /// `if (block.timestamp <= _metadata.licenseExpiry) revert`.
    pub fn mark_license_expired(env: Env) {
        require_role(&env, Role::Manager);
        if !metadata::is_license_expired(&env) {
            panic_with_error!(&env, MiningRightsError::LicenseAlreadyExpired);
        }
        asset::set_status(&env, AssetStatus::Expired);
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

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        require_role(&env, Role::Upgrader);
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }
}

#[contractimpl]
impl TokenInterface for MiningRightsToken {
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
