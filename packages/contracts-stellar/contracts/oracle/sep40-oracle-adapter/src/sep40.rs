use soroban_sdk::{contractclient, contracttype, Address, Env, Symbol, Vec};

/// SEP-40 asset identifier — a Stellar asset contract, or an off-chain
/// ticker (e.g. `XAU`, `NGN`).
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Sep40Asset {
    Stellar(Address),
    Other(Symbol),
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Sep40PriceData {
    pub price: i128,
    pub timestamp: u64,
}

/// The subset of the SEP-40 price-feed interface this adapter consumes.
/// Implemented by Reflector (the decentralized oracle network live on
/// Soroban mainnet/testnet) and any other SEP-40-compliant feed.
#[contractclient(name = "Sep40Client")]
pub trait Sep40Interface {
    fn decimals(env: Env) -> u32;
    fn lastprice(env: Env, asset: Sep40Asset) -> Option<Sep40PriceData>;
    fn prices(env: Env, asset: Sep40Asset, records: u32) -> Option<Vec<Sep40PriceData>>;
}
