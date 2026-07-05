#![no_std]

mod contract;
mod metadata;
#[cfg(test)]
mod test;

pub use contract::{FactoryError, Template, TokenFactory, TokenFactoryClient};
pub use metadata::{
    CarbonCreditMetadata, CommodityMetadata, FarmlandMetadata, InvoiceMetadata,
    MiningRightsMetadata, RealEstateMetadata,
};
