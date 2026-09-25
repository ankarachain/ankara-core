use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum CircleError {
    CircleNotFound = 1,
    InvalidConfig = 2,
    NotForming = 3,
    CircleFull = 4,
    AlreadyMember = 5,
    NotMember = 6,
    NotActive = 7,
    AlreadyContributed = 8,
    RoundNotReady = 9,
    WrongMode = 10,
    LoanOutstanding = 11,
    NoLoan = 12,
    ExceedsBorrowLimit = 13,
    InsufficientPool = 14,
    NotEnded = 15,
    AlreadyWithdrawn = 16,
    NotOrganizer = 17,
    Ended = 18,
}
