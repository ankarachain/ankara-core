#![no_std]

mod contract;
mod errors;
mod storage;
#[cfg(test)]
mod test;

pub use contract::{AttestationRegistry, AttestationRegistryClient};
pub use errors::AttestationError;
pub use storage::{Attestation, Subject};
