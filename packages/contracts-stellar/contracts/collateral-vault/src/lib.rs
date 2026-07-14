#![no_std]

mod contract;
mod errors;
mod loan;
#[cfg(test)]
mod test;

pub use contract::{CollateralVault, CollateralVaultClient};
pub use errors::VaultError;
pub use loan::{Loan, LoanStatus};
