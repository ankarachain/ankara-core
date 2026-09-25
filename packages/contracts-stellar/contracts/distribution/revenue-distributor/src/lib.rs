#![no_std]

mod contract;
#[cfg(test)]
mod test;

pub use contract::{Distribution, DistributorError, RevenueDistributor, RevenueDistributorClient};
