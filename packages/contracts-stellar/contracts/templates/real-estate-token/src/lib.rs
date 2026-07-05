#![no_std]

mod contract;
mod metadata;
#[cfg(test)]
mod test;

pub use contract::{RealEstateError, RealEstateToken, RealEstateTokenClient};
pub use metadata::RealEstateMetadata;
