use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, token,
    Address, Bytes, BytesN, Env, IntoVal, String, Symbol, Val, Vec,
};

/// Mirrors `NFTFactory.sol`'s `Template` enum.
#[contracttype]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Template {
    Farmland,
    RealEstate,
    MiningRights,
    CommodityVault,
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
    AllDeployedNfts,
    DeployerNfts(Address),
}

/// Deploys all 4 Ankara Chain NFT deed templates. Same WASM-hash-deploy +
/// dynamic-`invoke_contract` design as `token-factory` (see that crate's
/// module doc for why it doesn't depend on the template crates directly).
#[contract]
pub struct NFTFactory;

#[contractimpl]
impl NFTFactory {
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

    fn record_deployment(env: &Env, deployer: &Address, nft_address: &Address) {
        let mut all: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::AllDeployedNfts)
            .unwrap_or_else(|| Vec::new(env));
        all.push_back(nft_address.clone());
        env.storage().instance().set(&DataKey::AllDeployedNfts, &all);

        let key = DataKey::DeployerNfts(deployer.clone());
        let mut mine: Vec<Address> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));
        mine.push_back(nft_address.clone());
        env.storage().persistent().set(&key, &mine);
    }

    pub fn total_deployed(env: Env) -> u32 {
        Self::all_deployed_nfts(env).len()
    }

    pub fn all_deployed_nfts(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::AllDeployedNfts)
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn get_deployer_nfts(env: Env, deployer: Address) -> Vec<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::DeployerNfts(deployer))
            .unwrap_or_else(|| Vec::new(&env))
    }

    fn deploy_and_initialize(
        env: &Env,
        template: Template,
        deployer: &Address,
        payment_token: &Address,
        salt: BytesN<32>,
        asset_id: BytesN<32>,
        country_code: String,
        admin: Address,
        verifier: Option<Address>,
    ) -> Address {
        deployer.require_auth();
        Self::collect_fee(env, deployer, payment_token);
        let wasm_hash = Self::implementation(env, template);
        let deployed_address = env
            .deployer()
            .with_current_contract(salt)
            .deploy_v2(wasm_hash, ());
        let args: Vec<Val> = soroban_sdk::vec![
            env,
            asset_id.into_val(env),
            country_code.into_val(env),
            admin.into_val(env),
            verifier.into_val(env),
        ];
        env.invoke_contract::<()>(&deployed_address, &Symbol::new(env, "initialize"), args);
        Self::record_deployment(env, deployer, &deployed_address);
        env.events().publish(
            (symbol_short!("deployed"), template),
            (deployed_address.clone(), deployer.clone(), asset_id, country_code),
        );
        deployed_address
    }

    #[allow(clippy::too_many_arguments)]
    pub fn deploy_farmland_nft(
        env: Env,
        deployer: Address,
        payment_token: Address,
        salt: BytesN<32>,
        asset_id: BytesN<32>,
        country_code: String,
        admin: Address,
        verifier: Option<Address>,
    ) -> Address {
        Self::deploy_and_initialize(
            &env,
            Template::Farmland,
            &deployer,
            &payment_token,
            salt,
            asset_id,
            country_code,
            admin,
            verifier,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn deploy_real_estate_nft(
        env: Env,
        deployer: Address,
        payment_token: Address,
        salt: BytesN<32>,
        asset_id: BytesN<32>,
        country_code: String,
        admin: Address,
        verifier: Option<Address>,
    ) -> Address {
        Self::deploy_and_initialize(
            &env,
            Template::RealEstate,
            &deployer,
            &payment_token,
            salt,
            asset_id,
            country_code,
            admin,
            verifier,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn deploy_mining_rights_nft(
        env: Env,
        deployer: Address,
        payment_token: Address,
        salt: BytesN<32>,
        asset_id: BytesN<32>,
        country_code: String,
        admin: Address,
        verifier: Option<Address>,
    ) -> Address {
        Self::deploy_and_initialize(
            &env,
            Template::MiningRights,
            &deployer,
            &payment_token,
            salt,
            asset_id,
            country_code,
            admin,
            verifier,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn deploy_commodity_vault_nft(
        env: Env,
        deployer: Address,
        payment_token: Address,
        salt: BytesN<32>,
        asset_id: BytesN<32>,
        country_code: String,
        admin: Address,
        verifier: Option<Address>,
    ) -> Address {
        Self::deploy_and_initialize(
            &env,
            Template::CommodityVault,
            &deployer,
            &payment_token,
            salt,
            asset_id,
            country_code,
            admin,
            verifier,
        )
    }
}
