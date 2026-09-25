use soroban_sdk::contracterror;

/// Shared error codes across every Ankara Chain Soroban contract.
///
/// Mirrors the intent of the custom Solidity errors declared on
/// `AnkaraChainBaseToken`/`TokenFactory` (`NotVerified`, `ZeroAddress`,
/// `TemplateNotRegistered`, etc.) — individual contract crates may still
/// define their own additional error variants for domain-specific failures.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum CommonError {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    ZeroAddress = 3,
    NotVerified = 4,
    InsufficientBalance = 5,
    InsufficientAllowance = 6,
    TemplateNotRegistered = 7,
    TokenNotFound = 8,
    NotTokenOwner = 9,
    NotApprovedOrOwner = 10,
    ContractPaused = 11,
    AlreadyRegistered = 12,
    /// `balance_of_at`/`total_supply_at` for a snapshot id that doesn't exist.
    /// (Numbered 17 — 15/16 are reserved for the compliance-policy errors.)
    SnapshotNotFound = 17,
    NotRegistered = 13,
    MaxSupplyExceeded = 14,
}
