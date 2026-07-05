use ankara_common::{
    asset::AssetStatus,
    multi_token::{self, TokenDefinition},
    roles::{self, require_role, Role},
};
use soroban_sdk::{contract, contracterror, contractimpl, panic_with_error, symbol_short, Address, Env, String, Vec};

use crate::metadata::{self, BatchMetadata, WarehouseMetadata};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum BatchTokenError {
    IncompatibleBatches = 1,
    BatchIsExpired = 2,
}

#[contract]
pub struct CommodityBatchToken;

#[contractimpl]
impl CommodityBatchToken {
    pub fn initialize(
        env: Env,
        name: String,
        country_code: String,
        base_uri: String,
        admin: Address,
        warehouse: WarehouseMetadata,
    ) {
        roles::init_roles(&env, &admin);
        metadata::init_contract_metadata(&env, name, country_code, base_uri, warehouse);
    }

    // ─── Batch registration (Role::Manager) ──────────────────────────────

    /// Mirrors `registerBatch()` — registers the token-ID definition
    /// (`maxSupply = quantityKg`, 1 token = 1 kg) then stores the batch's
    /// domain metadata.
    pub fn register_batch(env: Env, id: u64, batch: BatchMetadata) {
        require_role(&env, Role::Manager);
        multi_token::register_token_id(
            &env,
            id,
            TokenDefinition {
                is_fungible: true,
                name: batch.commodity_type.clone(),
                symbol: String::from_str(&env, ""),
                max_supply: batch.quantity_kg,
                status: AssetStatus::Active,
                metadata_uri: String::from_str(&env, ""),
            },
        );
        metadata::register_batch_id(&env, id, batch);
    }

    pub fn update_batch_valuation(env: Env, id: u64, new_valuation_usd: i128) {
        require_role(&env, Role::Manager);
        let mut batch = metadata::get_batch_metadata(&env, id);
        let old = batch.valuation_usd;
        batch.valuation_usd = new_valuation_usd;
        metadata::set_batch_metadata(&env, id, &batch);
        env.events()
            .publish((symbol_short!("valuation"), id), (old, new_valuation_usd));
    }

    pub fn expire_batch(env: Env, id: u64) {
        require_role(&env, Role::Manager);
        multi_token::set_asset_status(&env, id, AssetStatus::Expired);
        env.events()
            .publish((symbol_short!("expired"), id), env.ledger().timestamp());
    }

    /// Mirrors `mergeBatches()` — manager-authorized burn-then-mint across
    /// two compatible, non-expired batches for the same holder.
    pub fn merge_batches(env: Env, from_id: u64, to_id: u64, amount: i128, holder: Address) {
        require_role(&env, Role::Manager);
        let from_batch = metadata::get_batch_metadata(&env, from_id);
        let to_batch = metadata::get_batch_metadata(&env, to_id);
        if from_batch.commodity_type != to_batch.commodity_type
            || from_batch.grade_classification != to_batch.grade_classification
        {
            panic_with_error!(&env, BatchTokenError::IncompatibleBatches);
        }
        if Self::is_expired(env.clone(), from_id) || Self::is_expired(env.clone(), to_id) {
            panic_with_error!(&env, BatchTokenError::BatchIsExpired);
        }
        multi_token::admin_move(&env, &holder, from_id, to_id, amount);
        env.events().publish(
            (symbol_short!("merged"), from_id, to_id),
            (amount, holder),
        );
    }

    // ─── Reads ──────────────────────────────────────────────────────────

    pub fn get_batch_metadata(env: Env, id: u64) -> BatchMetadata {
        metadata::get_batch_metadata(&env, id)
    }

    pub fn get_warehouse_metadata(env: Env) -> WarehouseMetadata {
        metadata::warehouse_metadata(&env)
    }

    pub fn is_expired(env: Env, id: u64) -> bool {
        let def = multi_token::get_token_definition(&env, id);
        if def.status == AssetStatus::Expired {
            return true;
        }
        metadata::is_naturally_expired(&env, id)
    }

    pub fn active_batch_count(env: Env) -> u32 {
        let ids = metadata::batch_ids(&env);
        let mut count = 0u32;
        for id in ids.iter() {
            if !Self::is_expired(env.clone(), id) {
                count += 1;
            }
        }
        count
    }

    pub fn batch_ids(env: Env) -> Vec<u64> {
        metadata::batch_ids(&env)
    }

    pub fn contract_name(env: Env) -> String {
        metadata::contract_name(&env)
    }

    pub fn contract_country_code(env: Env) -> String {
        metadata::country_code(&env)
    }

    pub fn is_registered(env: Env, id: u64) -> bool {
        multi_token::is_registered(&env, id)
    }

    pub fn get_token_definition(env: Env, id: u64) -> TokenDefinition {
        multi_token::get_token_definition(&env, id)
    }

    pub fn total_supply(env: Env, id: u64) -> i128 {
        multi_token::total_supply(&env, id)
    }

    pub fn balance_of(env: Env, owner: Address, id: u64) -> i128 {
        multi_token::balance_of(&env, &owner, id)
    }

    pub fn token_verifier(env: Env, id: u64) -> Option<Address> {
        multi_token::token_verifier(&env, id)
    }

    // ─── Writes (Role::Manager) ─────────────────────────────────────────

    pub fn set_asset_status(env: Env, id: u64, new_status: AssetStatus) {
        require_role(&env, Role::Manager);
        multi_token::set_asset_status(&env, id, new_status);
    }

    pub fn set_token_verifier(env: Env, id: u64, new_verifier: Option<Address>) {
        require_role(&env, Role::Manager);
        multi_token::set_token_verifier(&env, id, new_verifier);
    }

    // ─── Minting (Role::Minter) ──────────────────────────────────────────

    pub fn mint(env: Env, to: Address, id: u64, amount: i128) {
        require_role(&env, Role::Minter);
        multi_token::check_verified(&env, id, &to);
        multi_token::mint(&env, &to, id, amount);
    }

    pub fn mint_batch(env: Env, to: Address, ids: Vec<u64>, amounts: Vec<i128>) {
        require_role(&env, Role::Minter);
        for i in 0..ids.len() {
            let id = ids.get(i).unwrap();
            let amount = amounts.get(i).unwrap();
            multi_token::check_verified(&env, id, &to);
            multi_token::mint(&env, &to, id, amount);
        }
    }

    // ─── Transfers / burns (holder-initiated) ───────────────────────────

    pub fn transfer(env: Env, from: Address, to: Address, id: u64, amount: i128) {
        multi_token::check_verified(&env, id, &from);
        multi_token::check_verified(&env, id, &to);
        multi_token::transfer(&env, &from, &to, id, amount);
    }

    pub fn burn(env: Env, from: Address, id: u64, amount: i128) {
        multi_token::burn(&env, &from, id, amount);
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

    pub fn upgrade(env: Env, new_wasm_hash: soroban_sdk::BytesN<32>) {
        require_role(&env, Role::Upgrader);
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }
}
