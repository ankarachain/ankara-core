use ankara_common::{
    asset,
    nft,
    roles::{self, require_role, Role},
    verifier, AssetStatus,
};
use soroban_sdk::{contract, contractimpl, symbol_short, Address, BytesN, Env, String};

use crate::metadata::{self, RealEstateNFTMetadata};

#[contract]
pub struct RealEstateNFT;

#[contractimpl]
impl RealEstateNFT {
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

    pub fn mint(env: Env, to: Address, meta: RealEstateNFTMetadata) -> u64 {
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

    pub fn get_metadata(env: Env, token_id: u64) -> RealEstateNFTMetadata {
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

    pub fn update_metadata(env: Env, token_id: u64, meta: RealEstateNFTMetadata) {
        require_role(&env, Role::Manager);
        let old_valuation = metadata::get_metadata(&env, token_id).valuation_usd;
        let new_valuation = meta.valuation_usd;
        let version = metadata::set_metadata(&env, token_id, meta);
        env.events()
            .publish((symbol_short!("meta_upd"), token_id), version);
        if old_valuation != new_valuation {
            env.events().publish(
                (symbol_short!("valuation"), token_id),
                (old_valuation, new_valuation),
            );
        }
    }

    pub fn update_valuation(env: Env, token_id: u64, new_valuation_usd: i128) {
        require_role(&env, Role::Manager);
        let (old, version) = metadata::update_valuation(&env, token_id, new_valuation_usd);
        env.events()
            .publish((symbol_short!("valuation"), token_id), (old, new_valuation_usd));
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

    // ─── Title encumbrances & chain of custody (Role::Manager writes) ───

    /// `Some(reference)` flags the title as disputed (e.g. a court case
    /// number); `None` clears it.
    pub fn set_dispute(env: Env, token_id: u64, reference: Option<String>) {
        ankara_common::title::set_dispute(&env, token_id, reference);
    }

    /// `Some(reference)` flags a lien (e.g. lender + registration ID);
    /// `None` clears it.
    pub fn set_lien(env: Env, token_id: u64, reference: Option<String>) {
        ankara_common::title::set_lien(&env, token_id, reference);
    }

    pub fn title_flags(env: Env, token_id: u64) -> ankara_common::title::TitleFlags {
        ankara_common::title::title_flags(&env, token_id)
    }

    /// Append-only: records a prior/current owner and the deed or transfer
    /// instrument. Returns the entry's index.
    pub fn append_custody(
        env: Env,
        token_id: u64,
        owner: String,
        reference: String,
        effective_at: u64,
    ) -> u32 {
        ankara_common::title::append_custody(&env, token_id, owner, reference, effective_at)
    }

    pub fn custody_count(env: Env, token_id: u64) -> u32 {
        ankara_common::title::custody_count(&env, token_id)
    }

    pub fn custody_log(
        env: Env,
        token_id: u64,
        start: u32,
        limit: u32,
    ) -> soroban_sdk::Vec<ankara_common::title::CustodyEntry> {
        ankara_common::title::custody_log(&env, token_id, start, limit)
    }

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
