#![no_std]

mod contract;
mod credit;
mod errors;
mod loan;
#[cfg(test)]
mod test;

pub use contract::{CollateralVault, CollateralVaultClient};
pub use credit::{CreditScore, CreditScoreClient, CreditScoreInterface, ScoreConfig, ScoreTier, ScoredTerms};
pub use errors::VaultError;
pub use loan::{Loan, LoanStatus};
