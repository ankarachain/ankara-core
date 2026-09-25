use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RfqError {
    AlreadyInitialized = 1,
    InvalidAmount = 2,
    InvalidFee = 3,
    IntentNotFound = 4,
    QuoteNotFound = 5,
    IntentNotOpen = 6,
    IntentExpired = 7,
    QuoteNotActive = 8,
    QuoteExpired = 9,
    BelowMinimum = 10,
    NotSeller = 11,
    NotBuyer = 12,
    QuoteIntentMismatch = 13,
    SelfQuote = 14,
    InvalidExpiry = 15,
}
