use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RiskPoolError {
    AlreadyInitialized = 1,
    InvalidProduct = 2,
    ProductNotFound = 3,
    PolicyNotFound = 4,
    ProductNotActive = 5,
    OutsideCoverageWindow = 6,
    ConditionNotMet = 7,
    InsufficientCapital = 8,
    InvalidAmount = 9,
    NotAssetLinked = 10,
    NoHolding = 11,
    NotTriggered = 12,
    PolicyNotActive = 13,
    NotExpired = 14,
    StaleReading = 15,
}
