use ankara_common::{
    asset,
    nft,
    roles::{self, require_role, Role},
    verifier, AssetStatus,
};
use soroban_sdk::{contract, contractimpl, symbol_short, Address, BytesN, Env, String};

use crate::metadata::{self, FarmlandNFTMetadata};

#[contract]
pub struct FarmlandNFT;

#[contractimpl]
impl FarmlandNFT {
    /// Mirrors `FarmlandNFT.sol::initialize` — note NFT templates take no
    /// per-contract metadata or `fee_recipient` at init time (metadata is
    /// per-token, attached at `mint`).
    pub fn initialize(
        env: Env,
        asset_id: BytesN<32>,
        country_code: String,
        admin: Address,
        verifier: Option<Address>,
    ) {
        roles::init_roles(&env, &admin);
        asset::init_asset(&env, &asset_id, &country_code, &None);
        ankara_common::verifier::init_identity_verifier(&env, &verifier);
        nft::init_next_token_id(&env);
    }

    // ─── Minting (Role::Minter) ──────────────────────────────────────────

    /// Mirrors `mint(to, meta)` [MINTER_ROLE] — verifies `to`, then mints
    /// the next auto-incrementing token ID and attaches its metadata.
    pub fn mint(env: Env, to: Address, meta: FarmlandNFTMetadata) -> u64 {
        require_role(&env, Role::Minter);
        verifier::check_verified(&env, &to);
        let token_id = nft::mint_next(&env, &to);
        metadata::set_metadata(&env, token_id, meta);
        env.events().publish(
            (symbol_short!("nft_mint"), token_id),
            (to, asset::asset_id(&env)),
        );
        token_id
    }

    // ─── Reads ──────────────────────────────────────────────────────────

    pub fn get_metadata(env: Env, token_id: u64) -> FarmlandNFTMetadata {
        metadata::get_metadata(&env, token_id)
    }

    pub fn metadata_version(env: Env, token_id: u64) -> u32 {
        metadata::metadata_version(&env, token_id)
    }

    pub fn owner_of(env: Env, token_id: u64) -> Address {
        nft::owner_of(&env, token_id)
    }

    pub fn balance_of(env: Env, owner: Address) -> u64 {
        nft::balance_of(&env, &owner)
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

    pub fn linked_erc20(env: Env) -> Option<Address> {
        asset::linked_erc20(&env)
    }

    // ─── Writes (Role::Manager) ─────────────────────────────────────────

    pub fn update_metadata(env: Env, token_id: u64, meta: FarmlandNFTMetadata) {
        require_role(&env, Role::Manager);
        let version = metadata::set_metadata(&env, token_id, meta);
        env.events()
            .publish((symbol_short!("meta_upd"), token_id), version);
    }

    pub fn update_title_document(env: Env, token_id: u64, new_hash: BytesN<32>) {
        require_role(&env, Role::Manager);
        let version = metadata::update_title_document(&env, token_id, new_hash);
        env.events()
            .publish((symbol_short!("meta_upd"), token_id), version);
    }

    pub fn set_status(env: Env, new_status: AssetStatus) {
        asset::set_status_gated(&env, new_status);
    }

    pub fn set_identity_verifier(env: Env, new_verifier: Option<Address>) {
        verifier::set_identity_verifier(&env, &new_verifier);
    }

    pub fn link_to_erc20(env: Env, erc20_address: Address) {
        asset::link_erc20(&env, &erc20_address);
    }

    // ─── Transfers / approvals (no role gate — token owner/approved) ────

    pub fn transfer(env: Env, from: Address, to: Address, token_id: u64) {
        nft::transfer(&env, &from, &to, token_id);
    }

    pub fn transfer_from(env: Env, spender: Address, from: Address, to: Address, token_id: u64) {
        nft::transfer_from(&env, &spender, &from, &to, token_id);
    }

    pub fn approve(env: Env, owner: Address, approved: Option<Address>, token_id: u64) {
        nft::approve(&env, &owner, approved, token_id);
    }

    pub fn get_approved(env: Env, token_id: u64) -> Option<Address> {
        nft::get_approved(&env, token_id)
    }

    pub fn set_approval_for_all(env: Env, owner: Address, operator: Address, approved: bool) {
        nft::set_approval_for_all(&env, &owner, &operator, approved);
    }

    pub fn is_approved_for_all(env: Env, owner: Address, operator: Address) -> bool {
        nft::is_approved_for_all(&env, &owner, &operator)
    }

    pub fn burn(env: Env, owner: Address, token_id: u64) {
        nft::burn(&env, &owner, token_id);
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
