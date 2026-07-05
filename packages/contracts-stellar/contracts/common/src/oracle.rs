use soroban_sdk::{contractclient, Address, Env};

/// Cross-contract interface for calling any `IAnkaraOracle`-shaped
/// contract (e.g. `manual-oracle`), mirroring `IAnkaraOracle.sol`. Defined
/// here rather than depending on the `manual-oracle` crate directly, for
/// the same reason `token-factory`/`nft-factory` avoid depending on their
/// template crates — pulling in another deployable contract's crate would
/// drag its `#[contractimpl]`-exported wasm symbols into the caller's own
/// binary.
#[contractclient(name = "OracleClient")]
pub trait OracleInterface {
    fn get_price(env: Env, token: Address) -> (i128, u64);
    fn is_stale(env: Env, token: Address) -> bool;
}
