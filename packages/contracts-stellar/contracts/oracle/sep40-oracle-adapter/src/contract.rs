use ankara_common::{
    oracle::{OracleClient, OracleInterface},
    roles::{self, require_role, Role},
};
use soroban_sdk::{
    contract, contractimpl, contracttype, panic_with_error, symbol_short, Address, BytesN, Env,
};

use crate::errors::AdapterError;
use crate::sep40::{Sep40Asset, Sep40Client, Sep40PriceData};

/// Ankara's oracle convention (see `collateral-vault`/`pool-vault`): USD
/// prices with 18 decimals.
const TARGET_DECIMALS: u32 = 18;
const MAX_TWAP_RECORDS: u32 = 20;
/// SEP-40 specifies seconds, but some feeds report milliseconds. Anything
/// above this (≈ year 33658 in seconds) is treated as milliseconds.
const MS_TIMESTAMP_FLOOR: u64 = 1_000_000_000_000;

/// How a given Ankara token is priced on the external feed.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FeedConfig {
    pub asset: Sep40Asset,
    /// `0` = spot (`lastprice`); `n > 0` = average of the last `n` feed
    /// records (a TWAP over `n * resolution`), which damps short spikes.
    pub twap_records: u32,
}

#[contracttype]
enum DataKey {
    Feed,
    FeedDecimals,
    Fallback,
    StalenessThreshold,
    TokenFeed(Address),
}

/// `IAnkaraOracle`-compatible adapter over an external, decentralized
/// SEP-40 price feed (e.g. Reflector). Point `collateral-vault` or
/// `pool-vault` at this contract's address with their existing
/// `set_oracle` — they consume `OracleClient` generically, so no changes
/// are needed on their side.
///
/// - **Asset mapping** — each Ankara token is priced as a configurable
///   SEP-40 asset (`Stellar(sac)` or `Other(ticker)`); unmapped tokens are
///   looked up as `Stellar(token)`.
/// - **Scaling** — feed prices are rescaled from the feed's `decimals()` to
///   Ankara's 1e18 convention. The feed's base asset must be USD (or a USD
///   stablecoin) for the result to be a USD price.
/// - **TWAP** — optional per token.
/// - **Fallback** — optional `manual-oracle` (or any `OracleClient`) used
///   when the feed has no price, or only a stale one, for a token. Most
///   bespoke RWA tokens will never be on a public feed; the fallback lets
///   one oracle address serve both kinds of asset in a vault.
#[contract]
pub struct Sep40OracleAdapter;

#[contractimpl]
impl Sep40OracleAdapter {
    pub fn initialize(
        env: Env,
        admin: Address,
        feed: Address,
        staleness_threshold: u64,
        fallback: Option<Address>,
    ) {
        if roles::has_role(&env, Role::Manager) {
            panic_with_error!(&env, AdapterError::AlreadyInitialized);
        }
        roles::init_roles(&env, &admin);
        write_feed(&env, &feed);
        env.storage()
            .instance()
            .set(&DataKey::StalenessThreshold, &staleness_threshold);
        if let Some(fb) = fallback {
            env.storage().instance().set(&DataKey::Fallback, &fb);
        }
    }

    // ─── Admin (Role::Manager) ───────────────────────────────────────────

    /// Switch to a different SEP-40 feed (re-reads its decimals).
    pub fn set_feed(env: Env, feed: Address) {
        require_role(&env, Role::Manager);
        write_feed(&env, &feed);
        env.events().publish((symbol_short!("feed"),), feed);
    }

    pub fn set_fallback(env: Env, fallback: Option<Address>) {
        require_role(&env, Role::Manager);
        match &fallback {
            Some(fb) => env.storage().instance().set(&DataKey::Fallback, fb),
            None => env.storage().instance().remove(&DataKey::Fallback),
        }
        env.events().publish((symbol_short!("fallback"),), fallback);
    }

    pub fn set_staleness_threshold(env: Env, new_threshold: u64) {
        require_role(&env, Role::Manager);
        env.storage()
            .instance()
            .set(&DataKey::StalenessThreshold, &new_threshold);
    }

    /// Maps an Ankara token to its feed asset. `None` clears the mapping
    /// (the token is then looked up as `Stellar(token)`).
    pub fn set_token_feed(env: Env, token: Address, config: Option<FeedConfig>) {
        require_role(&env, Role::Manager);
        let key = DataKey::TokenFeed(token.clone());
        match &config {
            Some(c) => {
                if c.twap_records > MAX_TWAP_RECORDS {
                    panic_with_error!(&env, AdapterError::InvalidTwapRecords);
                }
                env.storage().persistent().set(&key, c);
            }
            None => env.storage().persistent().remove(&key),
        }
        env.events().publish((symbol_short!("mapping"), token), config);
    }

    // ─── Reads ───────────────────────────────────────────────────────────

    pub fn feed(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Feed).unwrap()
    }

    pub fn feed_decimals(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::FeedDecimals).unwrap()
    }

    pub fn fallback(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::Fallback)
    }

    pub fn staleness_threshold(env: Env) -> u64 {
        staleness_threshold(&env)
    }

    pub fn token_feed(env: Env, token: Address) -> FeedConfig {
        token_feed(&env, &token)
    }

    /// The feed's own price for `token`, scaled to 1e18, ignoring the
    /// fallback — `(0, 0)` if the feed has nothing.
    pub fn feed_price(env: Env, token: Address) -> (i128, u64) {
        read_feed(&env, &token).unwrap_or((0, 0))
    }

    /// `true` if the price `get_price` would return comes from the fallback.
    pub fn is_using_fallback(env: Env, token: Address) -> bool {
        !feed_is_fresh(&env, &token) && fallback(&env).is_some()
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        require_role(&env, Role::Upgrader);
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }
}

#[contractimpl]
impl OracleInterface for Sep40OracleAdapter {
    /// USD price with 18 decimals, and its timestamp in seconds. Uses the
    /// feed when it has a fresh price, else the fallback (if configured),
    /// else whatever the feed has (possibly stale / `(0, 0)`).
    fn get_price(env: Env, token: Address) -> (i128, u64) {
        let feed = read_feed(&env, &token);
        if let Some((_, ts)) = feed {
            if is_fresh(&env, ts) {
                return feed.unwrap();
            }
        }
        if let Some(fb) = fallback(&env) {
            return OracleClient::new(&env, &fb).get_price(&token);
        }
        feed.unwrap_or((0, 0))
    }

    fn is_stale(env: Env, token: Address) -> bool {
        if feed_is_fresh(&env, &token) {
            return false;
        }
        match fallback(&env) {
            Some(fb) => OracleClient::new(&env, &fb).is_stale(&token),
            None => true,
        }
    }
}

fn write_feed(env: &Env, feed: &Address) {
    let decimals = Sep40Client::new(env, feed).decimals();
    if decimals > TARGET_DECIMALS {
        panic_with_error!(env, AdapterError::UnsupportedDecimals);
    }
    env.storage().instance().set(&DataKey::Feed, feed);
    env.storage().instance().set(&DataKey::FeedDecimals, &decimals);
}

fn fallback(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::Fallback)
}

fn staleness_threshold(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::StalenessThreshold)
        .unwrap_or(0)
}

fn token_feed(env: &Env, token: &Address) -> FeedConfig {
    env.storage()
        .persistent()
        .get(&DataKey::TokenFeed(token.clone()))
        .unwrap_or(FeedConfig {
            asset: Sep40Asset::Stellar(token.clone()),
            twap_records: 0,
        })
}

fn normalize_ts(ts: u64) -> u64 {
    if ts >= MS_TIMESTAMP_FLOOR {
        ts / 1000
    } else {
        ts
    }
}

fn is_fresh(env: &Env, ts: u64) -> bool {
    ts != 0 && env.ledger().timestamp().saturating_sub(ts) <= staleness_threshold(env)
}

fn feed_is_fresh(env: &Env, token: &Address) -> bool {
    match read_feed(env, token) {
        Some((price, ts)) => price > 0 && is_fresh(env, ts),
        None => false,
    }
}

/// Reads the feed for `token` and returns `(price_1e18, timestamp_secs)`.
/// For TWAP, the timestamp is that of the most recent record.
fn read_feed(env: &Env, token: &Address) -> Option<(i128, u64)> {
    let feed: Address = env.storage().instance().get(&DataKey::Feed)?;
    let decimals: u32 = env.storage().instance().get(&DataKey::FeedDecimals)?;
    let config = token_feed(env, token);
    let client = Sep40Client::new(env, &feed);

    let data: Sep40PriceData = if config.twap_records == 0 {
        client.lastprice(&config.asset)?
    } else {
        let records = client.prices(&config.asset, &config.twap_records)?;
        if records.len() < config.twap_records {
            return None;
        }
        let mut sum: i128 = 0;
        let mut newest: u64 = 0;
        for r in records.iter() {
            sum += r.price;
            let ts = normalize_ts(r.timestamp);
            if ts > newest {
                newest = ts;
            }
        }
        Sep40PriceData {
            price: sum / (records.len() as i128),
            timestamp: newest,
        }
    };
    if data.price <= 0 {
        return None;
    }
    let scale = 10i128.pow(TARGET_DECIMALS - decimals);
    Some((data.price * scale, normalize_ts(data.timestamp)))
}
