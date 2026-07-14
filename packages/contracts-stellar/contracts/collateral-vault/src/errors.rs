use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum VaultError {
    ZeroAmount = 1,
    ExceedsLtv = 2,
    LoanNotOpen = 3,
    NotBorrower = 4,
    StaleOraclePrice = 5,
    InvalidConfig = 6,
    NotLiquidatable = 7,
}
