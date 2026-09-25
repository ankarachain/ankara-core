use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, token,
    Address, Bytes, BytesN, Env, IntoVal, String, Symbol, Val, Vec,
};

use crate::metadata::WarehouseMetadata;
use ankara_common::governance::GovernanceConfig;

/// Mirrors `MultiTokenFactory.sol`'s `Template` enum.
#[contracttype]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Template {
    CommodityBatch,
    PoolVault,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum FactoryError {
    TemplateNotRegistered = 1,
}

#[contracttype]
enum DataKey {
    Owner,
    Implementation(Template),
    DeploymentFee,
    FeeRecipient,
    AllDeployed,
    DeployerTokens(Address),
}

/// Deploys `CommodityBatchToken` (ERC-1155 equivalent) and `PoolVault`
/// (multi-asset ERC-20 fund) — the two structurally different template
/// types `MultiTokenFactory.sol` groups together on the EVM side. Same
/// WASM-hash-deploy + dynamic-`invoke_contract` design as the other
/// factories.
#[contract]
pub struct MultiTokenFactory;

#[contractimpl]
impl MultiTokenFactory {
    pub fn initialize(env: Env, owner: Address, fee_recipient: Address) {
        env.storage().instance().set(&DataKey::Owner, &owner);
        env.storage()
            .instance()
            .set(&DataKey::FeeRecipient, &fee_recipient);
        env.storage().instance().set(&DataKey::DeploymentFee, &0i128);
    }

    pub fn owner(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Owner).unwrap()
    }

    pub fn deployment_fee(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::DeploymentFee)
            .unwrap_or(0)
    }

    pub fn fee_recipient(env: Env) -> Address {
        env.storage().instance().get(&DataKey::FeeRecipient).unwrap()
    }

    pub fn register_template(env: Env, template: Template, wasm: Bytes) -> BytesN<32> {
        Self::require_owner(&env);
        let wasm_hash = env.deployer().upload_contract_wasm(wasm);
        env.storage()
            .instance()
            .set(&DataKey::Implementation(template), &wasm_hash);
        env.events()
            .publish((symbol_short!("template"),), (template, wasm_hash.clone()));
        wasm_hash
    }

    pub fn set_deployment_fee(env: Env, new_fee: i128) {
        Self::require_owner(&env);
        env.storage().instance().set(&DataKey::DeploymentFee, &new_fee);
    }

    pub fn set_fee_recipient(env: Env, new_recipient: Address) {
        Self::require_owner(&env);
        env.storage()
            .instance()
            .set(&DataKey::FeeRecipient, &new_recipient);
    }

    fn require_owner(env: &Env) -> Address {
        let owner: Address = env.storage().instance().get(&DataKey::Owner).unwrap();
        owner.require_auth();
        owner
    }

    fn implementation(env: &Env, template: Template) -> BytesN<32> {
        env.storage()
            .instance()
            .get(&DataKey::Implementation(template))
            .unwrap_or_else(|| panic_with_error!(env, FactoryError::TemplateNotRegistered))
    }

    fn collect_fee(env: &Env, payer: &Address, payment_token: &Address) {
        let fee = Self::deployment_fee(env.clone());
        if fee > 0 {
            let recipient = Self::fee_recipient(env.clone());
            let client = token::TokenClient::new(env, payment_token);
            client.transfer(payer, &recipient, &fee);
        }
    }

    fn record_deployment(env: &Env, deployer: &Address, address: &Address) {
        let mut all: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::AllDeployed)
            .unwrap_or_else(|| Vec::new(env));
        all.push_back(address.clone());
        env.storage().instance().set(&DataKey::AllDeployed, &all);

        let key = DataKey::DeployerTokens(deployer.clone());
        let mut mine: Vec<Address> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));
        mine.push_back(address.clone());
        env.storage().persistent().set(&key, &mine);
    }

    pub fn total_deployed(env: Env) -> u32 {
        Self::all_deployed_multi_tokens(env).len()
    }

    pub fn all_deployed_multi_tokens(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::AllDeployed)
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn get_deployer_tokens(env: Env, deployer: Address) -> Vec<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::DeployerTokens(deployer))
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Mirrors `deployCommodityBatchToken()`.
    #[allow(clippy::too_many_arguments)]
    pub fn deploy_commodity_batch_token(
        env: Env,
        deployer: Address,
        payment_token: Address,
        salt: BytesN<32>,
        name: String,
        country_code: String,
        base_uri: String,
        admin: Address,
        warehouse: WarehouseMetadata,
    ) -> Address {
        deployer.require_auth();
        Self::collect_fee(&env, &deployer, &payment_token);
        let wasm_hash = Self::implementation(&env, Template::CommodityBatch);
        let deployed_address = env
            .deployer()
            .with_current_contract(salt)
            .deploy_v2(wasm_hash, ());
        let args: Vec<Val> = soroban_sdk::vec![
            &env,
            name.into_val(&env),
            country_code.into_val(&env),
            base_uri.into_val(&env),
            admin.into_val(&env),
            warehouse.into_val(&env),
        ];
        env.invoke_contract::<()>(&deployed_address, &Symbol::new(&env, "initialize"), args);
        Self::record_deployment(&env, &deployer, &deployed_address);
        env.events().publish(
            (symbol_short!("deployed"), Template::CommodityBatch),
            (deployed_address.clone(), deployer),
        );
        deployed_address
    }

    /// Mirrors `deployPoolVault()`.
    #[allow(clippy::too_many_arguments)]
    pub fn deploy_pool_vault(
        env: Env,
        deployer: Address,
        payment_token: Address,
        salt: BytesN<32>,
        name: String,
        symbol: String,
        asset_id: BytesN<32>,
        country_code: String,
        admin: Address,
        verifier: Option<Address>,
        oracle: Option<Address>,
        management_fee_bps: u32,
    ) -> Address {
        deployer.require_auth();
        Self::collect_fee(&env, &deployer, &payment_token);
        let wasm_hash = Self::implementation(&env, Template::PoolVault);
        let deployed_address = env
            .deployer()
            .with_current_contract(salt)
            .deploy_v2(wasm_hash, ());
        let fee_recipient = Self::fee_recipient(env.clone());
        let args: Vec<Val> = soroban_sdk::vec![
            &env,
            name.into_val(&env),
            symbol.into_val(&env),
            asset_id.into_val(&env),
            country_code.into_val(&env),
            admin.into_val(&env),
            verifier.into_val(&env),
            Some(fee_recipient).into_val(&env),
            oracle.into_val(&env),
            management_fee_bps.into_val(&env),
        ];
        env.invoke_contract::<()>(&deployed_address, &Symbol::new(&env, "initialize"), args);
        Self::record_deployment(&env, &deployer, &deployed_address);
        env.events().publish(
            (symbol_short!("deployed"), Template::PoolVault),
            (deployed_address.clone(), deployer, asset_id, country_code),
        );
        deployed_address
    }

    /// Same as `deploy_pool_vault`, but the vault is born in token-weighted
    /// governance mode (`pool-vault::initialize_governed`): fee, oracle,
    /// accepted-token, min-deposit and upgrade changes can only happen via
    /// holder proposals. The deployment-time choice for cooperative- or
    /// community-owned funds.
    #[allow(clippy::too_many_arguments)]
    pub fn deploy_governed_pool_vault(
        env: Env,
        deployer: Address,
        payment_token: Address,
        salt: BytesN<32>,
        name: String,
        symbol: String,
        asset_id: BytesN<32>,
        country_code: String,
        admin: Address,
        verifier: Option<Address>,
        oracle: Option<Address>,
        management_fee_bps: u32,
        governance_config: GovernanceConfig,
    ) -> Address {
        deployer.require_auth();
        Self::collect_fee(&env, &deployer, &payment_token);
        let wasm_hash = Self::implementation(&env, Template::PoolVault);
        let deployed_address = env
            .deployer()
            .with_current_contract(salt)
            .deploy_v2(wasm_hash, ());
        let fee_recipient = Self::fee_recipient(env.clone());
        let args: Vec<Val> = soroban_sdk::vec![
            &env,
            name.into_val(&env),
            symbol.into_val(&env),
            asset_id.into_val(&env),
            country_code.into_val(&env),
            admin.into_val(&env),
            verifier.into_val(&env),
            Some(fee_recipient).into_val(&env),
            oracle.into_val(&env),
            management_fee_bps.into_val(&env),
            governance_config.into_val(&env),
        ];
        env.invoke_contract::<()>(&deployed_address, &Symbol::new(&env, "initialize_governed"), args);
        Self::record_deployment(&env, &deployer, &deployed_address);
        env.events().publish(
            (symbol_short!("deployed"), Template::PoolVault),
            (deployed_address.clone(), deployer, asset_id, country_code),
        );
        deployed_address
    }
}
