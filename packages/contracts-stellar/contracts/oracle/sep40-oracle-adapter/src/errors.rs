use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum AdapterError {
    AlreadyInitialized = 1,
    /// Feed decimals above 18 can't be scaled up to the 1e18 convention.
    UnsupportedDecimals = 2,
    InvalidTwapRecords = 3,
}
