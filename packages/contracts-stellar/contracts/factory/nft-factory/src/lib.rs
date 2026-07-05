#![no_std]

mod contract;
#[cfg(test)]
mod test;

pub use contract::{FactoryError, NFTFactory, NFTFactoryClient, Template};
