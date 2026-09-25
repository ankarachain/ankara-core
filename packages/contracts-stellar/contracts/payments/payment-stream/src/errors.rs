use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum StreamError {
    StreamNotFound = 1,
    InvalidAmount = 2,
    /// start < end required; cliff must lie within [start, end].
    InvalidSchedule = 3,
    NotRecipient = 4,
    NotSender = 5,
    NotCancelable = 6,
    StreamClosed = 7,
    ExceedsClaimable = 8,
    TooManyTranches = 9,
}
