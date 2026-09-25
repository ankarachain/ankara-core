#![no_std]

mod contract;
mod errors;
mod stream;
#[cfg(test)]
mod test;

pub use contract::{PaymentStream, PaymentStreamClient};
pub use errors::StreamError;
pub use stream::{Schedule, Stream, Tranche};
