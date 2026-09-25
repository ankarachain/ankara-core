use soroban_sdk::{contracttype, Address};

#[contracttype]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum IntentStatus {
    Open,
    Filled,
    Cancelled,
}

#[contracttype]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum QuoteStatus {
    Active,
    Accepted,
    Withdrawn,
}

/// A holder's intent to sell `amount` of `asset_token`, escrowed here.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Intent {
    pub id: u64,
    pub seller: Address,
    pub asset_token: Address,
    pub amount: i128,
    /// What the seller wants to be paid in (e.g. a USDC SAC).
    pub quote_token: Address,
    /// Quotes below this total price are rejected (0 = any).
    pub min_total_price: i128,
    pub expires_at: u64,
    pub status: IntentStatus,
    pub created_at: u64,
    /// Set once filled.
    pub accepted_quote: Option<u64>,
}

/// A counterparty's firm, fully-funded offer for an intent.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Quote {
    pub id: u64,
    pub intent_id: u64,
    pub buyer: Address,
    /// Total price for the whole intent, in the intent's `quote_token`.
    pub total_price: i128,
    pub expires_at: u64,
    pub status: QuoteStatus,
    pub created_at: u64,
}
