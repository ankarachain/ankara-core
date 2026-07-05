use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum EscrowError {
    ZeroAmount = 1,
    SamePartyNotAllowed = 2,
    NoMilestones = 3,
    LengthMismatch = 4,
    AlreadyFunded = 5,
    NotFunded = 6,
    NotPayer = 7,
    NotPayee = 8,
    NotParty = 9,
    NotArbiter = 10,
    InvalidMilestoneId = 11,
    InvalidMilestoneStatus = 12,
    TimelockNotElapsed = 13,
    AlreadyCancelled = 14,
}
