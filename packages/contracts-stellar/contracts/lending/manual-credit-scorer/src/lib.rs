#![no_std]

mod contract;
#[cfg(test)]
mod test;

pub use contract::{CreditScore, ManualCreditScorer, ManualCreditScorerClient, ScoreEntry};
