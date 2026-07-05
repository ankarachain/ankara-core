use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, token,
    Address, Bytes, BytesN, Env, IntoVal, Symbol, Val, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum FactoryError {
    ImplementationNotSet = 1,
}

#[contracttype]
enum DataKey {
    Owner,
    Implementation,
    DeploymentFee,
    FeeRecipient,
    AllDeployed,
    DeployerSettlements(Address),
}

/// Mirrors `RampSettlementFactory.sol` — single implementation slot, same
/// shape as `EscrowFactory`/`escrow-factory` since there's only one
/// settlement contract type.
#[contract]
pub struct RampSettlementFactory;

#[contractimpl]
impl RampSettlementFactory {
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

    pub fn set_implementation(env: Env, wasm: Bytes) -> BytesN<32> {
        Self::require_owner(&env);
        let wasm_hash = env.deployer().upload_contract_wasm(wasm);
        env.storage()
            .instance()
            .set(&DataKey::Implementation, &wasm_hash);
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

    fn implementation(env: &Env) -> BytesN<32> {
        env.storage()
            .instance()
            .get(&DataKey::Implementation)
            .unwrap_or_else(|| panic_with_error!(env, FactoryError::ImplementationNotSet))
    }

    fn collect_fee(env: &Env, payer: &Address, payment_token: &Address) {
        let fee = Self::deployment_fee(env.clone());
        if fee > 0 {
            let recipient = Self::fee_recipient(env.clone());
            token::TokenClient::new(env, payment_token).transfer(payer, &recipient, &fee);
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

        let key = DataKey::DeployerSettlements(deployer.clone());
        let mut mine: Vec<Address> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));
        mine.push_back(address.clone());
        env.storage().persistent().set(&key, &mine);
    }

    pub fn total_deployed(env: Env) -> u32 {
        Self::all_deployed_settlements(env).len()
    }

    pub fn all_deployed_settlements(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::AllDeployed)
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn get_deployer_settlements(env: Env, deployer: Address) -> Vec<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::DeployerSettlements(deployer))
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Mirrors `deployRampSettlement(admin_, treasury_)`.
    pub fn deploy_ramp_settlement(
        env: Env,
        deployer: Address,
        payment_token: Address,
        salt: BytesN<32>,
        admin: Address,
        treasury: Address,
    ) -> Address {
        deployer.require_auth();
        Self::collect_fee(&env, &deployer, &payment_token);
        let wasm_hash = Self::implementation(&env);
        let deployed_address = env
            .deployer()
            .with_current_contract(salt)
            .deploy_v2(wasm_hash, ());
        let args: Vec<Val> = soroban_sdk::vec![&env, admin.into_val(&env), treasury.into_val(&env)];
        env.invoke_contract::<()>(&deployed_address, &Symbol::new(&env, "initialize"), args);
        Self::record_deployment(&env, &deployer, &deployed_address);
        env.events().publish(
            (symbol_short!("deployed"),),
            (deployed_address.clone(), deployer, admin, treasury),
        );
        deployed_address
    }
}
