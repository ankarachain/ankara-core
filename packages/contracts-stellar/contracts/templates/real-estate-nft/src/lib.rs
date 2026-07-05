#![no_std]

mod contract;
mod metadata;
#[cfg(test)]
mod test;

pub use contract::{RealEstateNFT, RealEstateNFTClient};
pub use metadata::RealEstateNFTMetadata;
