use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum AttestationError {
    AlreadyInitialized = 1,
    NotAttestor = 2,
    AttestationNotFound = 3,
    AlreadyRevoked = 4,
    /// Only the attestor who posted a claim (or the Manager) may revoke it.
    NotClaimAttestor = 5,
    /// `expires_at` must be in the future (or `0` for "never expires").
    InvalidExpiry = 6,
    PageTooLarge = 7,
}
