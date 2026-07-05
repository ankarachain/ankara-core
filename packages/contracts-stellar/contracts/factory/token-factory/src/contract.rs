use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, token,
    Address, Bytes, BytesN, Env, IntoVal, String, Symbol, Val, Vec,
};

use crate::metadata::{
    CarbonCreditMetadata, CommodityMetadata, FarmlandMetadata, InvoiceMetadata,
    MiningRightsMetadata, RealEstateMetadata,
};

/// Mirrors `TokenFactory.sol`'s `Template` enum, in the same declaration
/// order (FARMLAND=0 .. MINING_RIGHTS=5).
#[contracttype]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Template {
    Farmland,
    CommodityReceipt,
    RealEstate,
    Invoice,
    CarbonCredit,
    MiningRights,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum FactoryError {
    TemplateNotRegistered = 1,
    InsufficientFee = 2,
}

#[contracttype]
enum DataKey {
    Owner,
    Implementation(Template),
    DeploymentFee,
    FeeRecipient,
    AllDeployedTokens,
    DeployerTokens(Address),
}

/// Deploys all 6 Ankara Chain fungible RWA templates via Soroban's
/// WASM-hash deployer, the Soroban analogue of `TokenFactory.sol`'s
/// `ERC1967Proxy(impl, initData)` pattern. Soroban has no proxy/delegatecall
/// story: each `deploy_*_token` call installs a *new, independent* contract
/// instance that shares the uploaded WASM code by hash (no per-instance
/// bytecode duplication cost), then cross-contract-calls that instance's
/// own `initialize(...)` dynamically via `env.invoke_contract` — this crate
/// deliberately does not depend on the template crates themselves (see the
/// Cargo.toml comment) to avoid wasm export-symbol collisions between them.
#[contract]
pub struct TokenFactory;

#[contractimpl]
impl TokenFactory {
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

    // ─── Admin (owner only) ──────────────────────────────────────────────

    /// Uploads `wasm` and registers it as the implementation for
    /// `template`, mirroring `registerTemplate(Template, address)`.
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

    /// Pulls `deployment_fee` from `payer` in `payment_token` (any
    /// SEP-41-compliant token, e.g. the native XLM Stellar Asset Contract)
    /// to `fee_recipient`. No-ops when the fee is 0 (the EVM default during
    /// testnet), mirroring `_collectFee()`.
    fn collect_fee(env: &Env, payer: &Address, payment_token: &Address) {
        let fee = Self::deployment_fee(env.clone());
        if fee > 0 {
            let recipient = Self::fee_recipient(env.clone());
            let client = token::TokenClient::new(env, payment_token);
            client.transfer(payer, &recipient, &fee);
        }
    }

    fn record_deployment(env: &Env, deployer: &Address, token_address: &Address) {
        let mut all: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::AllDeployedTokens)
            .unwrap_or_else(|| Vec::new(env));
        all.push_back(token_address.clone());
        env.storage()
            .instance()
            .set(&DataKey::AllDeployedTokens, &all);

        let key = DataKey::DeployerTokens(deployer.clone());
        let mut mine: Vec<Address> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));
        mine.push_back(token_address.clone());
        env.storage().persistent().set(&key, &mine);
    }

    /// Deploys a fresh instance of `template`'s registered WASM at `salt`
    /// and returns its address, without initializing it — the caller then
    /// builds template-specific `initialize` args and calls
    /// `invoke_initialize`.
    fn deploy_instance(env: &Env, template: Template, salt: BytesN<32>) -> Address {
        let wasm_hash = Self::implementation(env, template);
        env.deployer()
            .with_current_contract(salt)
            .deploy_v2(wasm_hash, ())
    }

    /// Cross-contract-calls the deployed instance's `initialize(...)`,
    /// built dynamically from `args` rather than a typed client (see the
    /// module doc comment for why).
    fn invoke_initialize(env: &Env, target: &Address, args: Vec<Val>) {
        env.invoke_contract::<()>(target, &Symbol::new(env, "initialize"), args);
    }

    fn emit_deployed(
        env: &Env,
        template: Template,
        token_address: &Address,
        deployer: &Address,
        asset_id: &BytesN<32>,
        country_code: &String,
    ) {
        env.events().publish(
            (symbol_short!("deployed"), template),
            (
                token_address.clone(),
                deployer.clone(),
                asset_id.clone(),
                country_code.clone(),
            ),
        );
    }

    // ─── Views ──────────────────────────────────────────────────────────

    pub fn total_deployed(env: Env) -> u32 {
        Self::all_deployed_tokens(env).len()
    }

    pub fn all_deployed_tokens(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::AllDeployedTokens)
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn get_deployer_tokens(env: Env, deployer: Address) -> Vec<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::DeployerTokens(deployer))
            .unwrap_or_else(|| Vec::new(&env))
    }

    // ─── Deploy: Farmland ───────────────────────────────────────────────

    #[allow(clippy::too_many_arguments)]
    pub fn deploy_farmland_token(
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
        metadata: FarmlandMetadata,
    ) -> Address {
        deployer.require_auth();
        Self::collect_fee(&env, &deployer, &payment_token);
        let deployed_address = Self::deploy_instance(&env, Template::Farmland, salt);
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
            metadata.into_val(&env),
        ];
        Self::invoke_initialize(&env, &deployed_address, args);
        Self::record_deployment(&env, &deployer, &deployed_address);
        Self::emit_deployed(
            &env,
            Template::Farmland,
            &deployed_address,
            &deployer,
            &asset_id,
            &country_code,
        );
        deployed_address
    }

    // ─── Deploy: Commodity Receipt ──────────────────────────────────────

    #[allow(clippy::too_many_arguments)]
    pub fn deploy_commodity_receipt_token(
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
        metadata: CommodityMetadata,
    ) -> Address {
        deployer.require_auth();
        Self::collect_fee(&env, &deployer, &payment_token);
        let deployed_address = Self::deploy_instance(&env, Template::CommodityReceipt, salt);
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
            metadata.into_val(&env),
        ];
        Self::invoke_initialize(&env, &deployed_address, args);
        Self::record_deployment(&env, &deployer, &deployed_address);
        Self::emit_deployed(
            &env,
            Template::CommodityReceipt,
            &deployed_address,
            &deployer,
            &asset_id,
            &country_code,
        );
        deployed_address
    }

    // ─── Deploy: Real Estate ────────────────────────────────────────────

    #[allow(clippy::too_many_arguments)]
    pub fn deploy_real_estate_token(
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
        metadata: RealEstateMetadata,
    ) -> Address {
        deployer.require_auth();
        Self::collect_fee(&env, &deployer, &payment_token);
        let deployed_address = Self::deploy_instance(&env, Template::RealEstate, salt);
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
            metadata.into_val(&env),
        ];
        Self::invoke_initialize(&env, &deployed_address, args);
        Self::record_deployment(&env, &deployer, &deployed_address);
        Self::emit_deployed(
            &env,
            Template::RealEstate,
            &deployed_address,
            &deployer,
            &asset_id,
            &country_code,
        );
        deployed_address
    }

    // ─── Deploy: Invoice ────────────────────────────────────────────────

    #[allow(clippy::too_many_arguments)]
    pub fn deploy_invoice_token(
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
        metadata: InvoiceMetadata,
    ) -> Address {
        deployer.require_auth();
        Self::collect_fee(&env, &deployer, &payment_token);
        let deployed_address = Self::deploy_instance(&env, Template::Invoice, salt);
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
            metadata.into_val(&env),
        ];
        Self::invoke_initialize(&env, &deployed_address, args);
        Self::record_deployment(&env, &deployer, &deployed_address);
        Self::emit_deployed(
            &env,
            Template::Invoice,
            &deployed_address,
            &deployer,
            &asset_id,
            &country_code,
        );
        deployed_address
    }

    // ─── Deploy: Carbon Credit ──────────────────────────────────────────

    #[allow(clippy::too_many_arguments)]
    pub fn deploy_carbon_credit_token(
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
        metadata: CarbonCreditMetadata,
    ) -> Address {
        deployer.require_auth();
        Self::collect_fee(&env, &deployer, &payment_token);
        let deployed_address = Self::deploy_instance(&env, Template::CarbonCredit, salt);
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
            metadata.into_val(&env),
        ];
        Self::invoke_initialize(&env, &deployed_address, args);
        Self::record_deployment(&env, &deployer, &deployed_address);
        Self::emit_deployed(
            &env,
            Template::CarbonCredit,
            &deployed_address,
            &deployer,
            &asset_id,
            &country_code,
        );
        deployed_address
    }

    // ─── Deploy: Mining Rights ──────────────────────────────────────────

    #[allow(clippy::too_many_arguments)]
    pub fn deploy_mining_rights_token(
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
        metadata: MiningRightsMetadata,
    ) -> Address {
        deployer.require_auth();
        Self::collect_fee(&env, &deployer, &payment_token);
        let deployed_address = Self::deploy_instance(&env, Template::MiningRights, salt);
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
            metadata.into_val(&env),
        ];
        Self::invoke_initialize(&env, &deployed_address, args);
        Self::record_deployment(&env, &deployer, &deployed_address);
        Self::emit_deployed(
            &env,
            Template::MiningRights,
            &deployed_address,
            &deployer,
            &asset_id,
            &country_code,
        );
        deployed_address
    }
}
