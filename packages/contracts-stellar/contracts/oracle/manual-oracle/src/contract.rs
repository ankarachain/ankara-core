use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol};

/// Direct port of `ManualOracle.sol` — deliberately standalone (no
/// dependency on `ankara-common`'s 4-role model, matching the EVM version
/// which only ever grants a single `MANAGER_ROLE`) and, like its EVM
/// counterpart, has no upgrade path — deploy a new instance to change logic.
#[contracttype]
enum DataKey {
    Manager,
    StalenessThreshold,
    Price(Address),
}

#[contracttype]
#[derive(Clone)]
struct PriceData {
    price_usd: i128,
    timestamp: u64,
}

#[contract]
pub struct ManualOracle;

#[contractimpl]
impl ManualOracle {
    /// `staleness_threshold` is in seconds; pass 86400 for the 24-hour
    /// default the EVM docs recommend.
    pub fn initialize(env: Env, admin: Address, staleness_threshold: u64) {
        env.storage().instance().set(&DataKey::Manager, &admin);
        env.storage()
            .instance()
            .set(&DataKey::StalenessThreshold, &staleness_threshold);
    }

    pub fn manager(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Manager).unwrap()
    }

    fn require_manager(env: &Env) {
        let manager: Address = env.storage().instance().get(&DataKey::Manager).unwrap();
        manager.require_auth();
    }

    pub fn set_price(env: Env, token: Address, price_usd: i128) {
        Self::require_manager(&env);
        let data = PriceData {
            price_usd,
            timestamp: env.ledger().timestamp(),
        };
        env.storage()
            .persistent()
            .set(&DataKey::Price(token.clone()), &data);
        env.events()
            .publish((Symbol::new(&env, "price_set"), token), (price_usd, data.timestamp));
    }

    pub fn set_staleness_threshold(env: Env, new_threshold: u64) {
        Self::require_manager(&env);
        let old = Self::staleness_threshold(env.clone());
        env.storage()
            .instance()
            .set(&DataKey::StalenessThreshold, &new_threshold);
        env.events().publish(
            (Symbol::new(&env, "threshold"),),
            (old, new_threshold),
        );
    }

    pub fn staleness_threshold(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::StalenessThreshold)
            .unwrap_or(0)
    }

    /// Returns `(price_usd, timestamp)`, both `0` if never set — mirrors
    /// `getPrice()`'s return shape exactly (no `Option`, for parity).
    pub fn get_price(env: Env, token: Address) -> (i128, u64) {
        match env
            .storage()
            .persistent()
            .get::<_, PriceData>(&DataKey::Price(token))
        {
            Some(data) => (data.price_usd, data.timestamp),
            None => (0, 0),
        }
    }

    /// A price is stale if never set, or older than `staleness_threshold`.
    pub fn is_stale(env: Env, token: Address) -> bool {
        match env
            .storage()
            .persistent()
            .get::<_, PriceData>(&DataKey::Price(token))
        {
            None => true,
            Some(data) => {
                if data.timestamp == 0 {
                    return true;
                }
                let threshold = Self::staleness_threshold(env.clone());
                env.ledger().timestamp() - data.timestamp > threshold
            }
        }
    }
}
