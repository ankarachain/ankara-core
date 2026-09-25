#![no_std]

mod contract;
mod errors;
#[cfg(test)]
mod test;

pub use contract::{VerificationRecord, WhitelistVerifier, WhitelistVerifierClient};
pub use errors::WhitelistError;
