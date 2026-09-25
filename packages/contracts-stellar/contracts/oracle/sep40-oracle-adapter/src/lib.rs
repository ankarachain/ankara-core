#![no_std]

mod contract;
mod errors;
mod sep40;
#[cfg(test)]
mod test;

pub use contract::{FeedConfig, Sep40OracleAdapter, Sep40OracleAdapterClient};
pub use errors::AdapterError;
pub use sep40::{Sep40Asset, Sep40PriceData};
