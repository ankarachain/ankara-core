#![no_std]

mod contract;
mod deal;
mod errors;
#[cfg(test)]
mod test;

pub use contract::{MilestoneEscrow, MilestoneEscrowClient};
pub use deal::{Milestone, MilestoneStatus};
pub use errors::EscrowError;
