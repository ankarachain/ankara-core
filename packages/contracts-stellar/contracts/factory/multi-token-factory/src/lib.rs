#![no_std]

mod contract;
mod metadata;
#[cfg(test)]
mod test;

pub use contract::{FactoryError, MultiTokenFactory, MultiTokenFactoryClient, Template};
pub use metadata::WarehouseMetadata;
