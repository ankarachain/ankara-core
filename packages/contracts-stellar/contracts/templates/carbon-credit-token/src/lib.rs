#![no_std]

mod contract;
mod metadata;
#[cfg(test)]
mod test;

pub use contract::{CarbonCreditError, CarbonCreditToken, CarbonCreditTokenClient};
pub use metadata::{CarbonCreditMetadata, RetirementRecord};
