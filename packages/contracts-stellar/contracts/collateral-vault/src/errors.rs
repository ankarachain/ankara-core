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
    /// `open_scored_loan` with no credit-score source configured.
    NoScoreSource = 8,
    /// The score source has no score for this borrower.
    NoScore = 9,
    /// The borrower's score is older than `max_score_age`.
    StaleScore = 10,
    /// The score is below every configured tier.
    ScoreTooLow = 11,
    /// Term is zero or longer than the tier allows.
    InvalidTerm = 12,
    /// `mark_defaulted` before the loan's due date.
    NotDue = 13,
    ExceedsCreditLimit = 14,
}
