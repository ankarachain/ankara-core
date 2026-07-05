use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, vec, Address, Env, IntoVal, Symbol, Vec,
};

/// Mirrors `AnkaraFactoryRegistry.sol`'s `FactoryType` enum.
#[contracttype]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum FactoryType {
    Erc20,
    Nft,
    MultiToken,
    Escrow,
    Ramp,
}

#[contracttype]
enum DataKey {
    Owner,
    Factory(FactoryType),
}

/// Unified top-level registry pointing to all five Ankara Chain
/// sub-factories, mirroring `AnkaraFactoryRegistry.sol`. Each sub-factory
/// exposes a differently-named "list my deployments" view
/// (`get_deployer_tokens`, `get_deployer_nfts`, `get_deployer_escrows`,
/// `get_deployer_settlements`) and "list everything" view
/// (`all_deployed_tokens`, `all_deployed_nfts`, ...), so this registry
/// dispatches to the right function name per `FactoryType` via
/// `env.invoke_contract` rather than a shared trait.
#[contract]
pub struct AnkaraFactoryRegistry;

#[contractimpl]
impl AnkaraFactoryRegistry {
    pub fn initialize(env: Env, owner: Address) {
        env.storage().instance().set(&DataKey::Owner, &owner);
    }

    pub fn owner(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Owner).unwrap()
    }

    /// Mirrors `setFactory()` [onlyOwner]. Pass `None` to clear an entry.
    pub fn set_factory(env: Env, factory_type: FactoryType, factory: Option<Address>) {
        let owner: Address = env.storage().instance().get(&DataKey::Owner).unwrap();
        owner.require_auth();
        match &factory {
            Some(addr) => env
                .storage()
                .instance()
                .set(&DataKey::Factory(factory_type), addr),
            None => env.storage().instance().remove(&DataKey::Factory(factory_type)),
        }
        env.events()
            .publish((symbol_short!("factory"), factory_type), factory);
    }

    pub fn get_factory(env: Env, factory_type: FactoryType) -> Option<Address> {
        env.storage().instance().get(&DataKey::Factory(factory_type))
    }

    fn deployer_view_fn_name(factory_type: FactoryType) -> &'static str {
        match factory_type {
            FactoryType::Erc20 => "get_deployer_tokens",
            FactoryType::Nft => "get_deployer_nfts",
            FactoryType::MultiToken => "get_deployer_tokens",
            FactoryType::Escrow => "get_deployer_escrows",
            FactoryType::Ramp => "get_deployer_settlements",
        }
    }

    fn all_deployed_fn_name(factory_type: FactoryType) -> &'static str {
        match factory_type {
            FactoryType::Erc20 => "all_deployed_tokens",
            FactoryType::Nft => "all_deployed_nfts",
            FactoryType::MultiToken => "all_deployed_multi_tokens",
            FactoryType::Escrow => "all_deployed_escrows",
            FactoryType::Ramp => "all_deployed_settlements",
        }
    }

    fn call_deployer_view(env: &Env, factory_type: FactoryType, deployer: &Address) -> Vec<Address> {
        let factory: Option<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Factory(factory_type));
        match factory {
            None => Vec::new(env),
            Some(addr) => {
                let fn_name = Self::deployer_view_fn_name(factory_type);
                env.invoke_contract::<Vec<Address>>(
                    &addr,
                    &Symbol::new(env, fn_name),
                    vec![env, deployer.into_val(env)],
                )
            }
        }
    }

    fn call_all_deployed(env: &Env, factory_type: FactoryType) -> Vec<Address> {
        let factory: Option<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Factory(factory_type));
        match factory {
            None => Vec::new(env),
            Some(addr) => {
                let fn_name = Self::all_deployed_fn_name(factory_type);
                env.invoke_contract::<Vec<Address>>(&addr, &Symbol::new(env, fn_name), vec![env])
            }
        }
    }

    /// Mirrors `getAllDeployedByAddress()` — concatenates results across
    /// all five sub-factories; a factory that isn't registered contributes
    /// an empty list.
    pub fn get_all_deployed_by_address(env: Env, deployer: Address) -> Vec<Address> {
        let mut result: Vec<Address> = Vec::new(&env);
        for factory_type in [
            FactoryType::Erc20,
            FactoryType::Nft,
            FactoryType::MultiToken,
            FactoryType::Escrow,
            FactoryType::Ramp,
        ] {
            for addr in Self::call_deployer_view(&env, factory_type, &deployer).iter() {
                result.push_back(addr);
            }
        }
        result
    }

    /// Mirrors `isAnkaraToken()` — O(n) across every deployed contract from
    /// every registered factory, intended for view calls only (same
    /// caveat as the EVM source).
    pub fn is_ankara_token(env: Env, token_address: Address) -> bool {
        for factory_type in [
            FactoryType::Erc20,
            FactoryType::Nft,
            FactoryType::MultiToken,
            FactoryType::Escrow,
            FactoryType::Ramp,
        ] {
            for addr in Self::call_all_deployed(&env, factory_type).iter() {
                if addr == token_address {
                    return true;
                }
            }
        }
        false
    }
}
