#![no_std]

mod contract;
mod metadata;
#[cfg(test)]
mod test;

pub use contract::{MiningRightsError, MiningRightsToken, MiningRightsTokenClient};
pub use metadata::MiningRightsMetadata;
