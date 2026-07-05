#![no_std]

mod contract;
mod records;
#[cfg(test)]
mod test;

pub use contract::{RampError, RampSettlement, RampSettlementClient};
pub use records::{OffRampDeposit, OnRampRecord, SettlementStatus};
