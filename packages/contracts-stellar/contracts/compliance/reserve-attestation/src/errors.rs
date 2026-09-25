use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ReserveError {
    AlreadyInitialized = 1,
    NotAttestor = 2,
    /// Quorum must be between 1 and the number of attestors.
    InvalidQuorum = 3,
    AlreadySubmitted = 4,
    InvalidAmount = 5,
    AttestorExists = 6,
    TooManyAttestors = 7,
    ReportNotFound = 8,
}
