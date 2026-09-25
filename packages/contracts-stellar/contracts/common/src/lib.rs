#![no_std]

//! Shared helpers used by every Ankara Chain Soroban contract crate.
//!
//! Soroban contracts cannot inherit from one another the way Solidity's
//! `AnkaraChainBaseToken` is inherited by each EVM template. Instead, every
//! concrete contract crate (e.g. `farmland-token`) imports this crate as a
//! plain library and calls these functions from within its own
//! `#[contractimpl]` block. Storage access here (`env.storage()...`) is
//! always scoped to whichever contract is currently executing, so this
//! composition-over-inheritance approach behaves identically to the EVM
//! base-contract pattern from the caller's point of view.

pub mod asset;
pub mod compliance;
pub mod errors;
pub mod fungible;
pub mod multi_token;
pub mod nft;
pub mod oracle;
pub mod pausable;
pub mod roles;
pub mod title;
pub mod verifier;

pub use asset::AssetStatus;
pub use compliance::{CompliancePolicyClient, CompliancePolicyInterface};
pub use errors::CommonError;
pub use roles::Role;
pub use verifier::{IdentityVerifierClient, IdentityVerifierInterface};
