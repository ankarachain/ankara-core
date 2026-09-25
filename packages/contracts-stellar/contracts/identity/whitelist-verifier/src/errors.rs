use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum WhitelistError {
    AlreadyInitialized = 1,
    /// `expires_at` must be in the future (or `0` for "never expires").
    InvalidExpiry = 2,
    BatchTooLarge = 3,
}
