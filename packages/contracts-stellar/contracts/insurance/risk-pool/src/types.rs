use soroban_sdk::{contracttype, Address, BytesN, Symbol};

/// Same shape as `attestation-registry`'s `Subject` (Soroban types match
/// structurally), so a `ClaimMissing` trigger can read that registry
/// without depending on its crate.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Subject {
    Account(Address),
    Asset(BytesN<32>),
}

/// The verifiable condition that pays out a product's policies.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Trigger {
    /// `(oracle, key, threshold)` — fires when the oracle's fresh value for
    /// `key` is **below** `threshold` (rainfall index, NDVI, commodity
    /// price). Any `IAnkaraOracle`-shaped contract: `manual-oracle`, the
    /// SEP-40 adapter, a weather-data relayer. `key` is whatever address the
    /// oracle publishes the index under.
    OracleBelow(Address, Address, i128),
    /// `(oracle, key, threshold)` — fires when the value is **above**
    /// `threshold` (temperature, flood gauge).
    OracleAbove(Address, Address, i128),
    /// `(registry, subject, claim_type, deadline)` — fires when no valid
    /// claim of `claim_type` about `subject` exists after `deadline`: a
    /// delivery or harvest confirmation that never arrived. Reads any
    /// contract with `attestation-registry`'s `has_valid_claim`.
    ClaimMissing(Address, Subject, Symbol, u64),
}

#[contracttype]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum ProductStatus {
    Active,
    Triggered,
    Expired,
}

/// A parametric cover product: one trigger, one coverage window, one
/// premium rate. Policies are bought against it.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Product {
    pub id: u64,
    pub trigger: Trigger,
    pub coverage_start: u64,
    pub coverage_end: u64,
    /// Premium as bps of the coverage amount.
    pub premium_bps: u32,
    /// Optional asset linkage: coverage is sized from the holder's balance
    /// of this token (`units × coverage_per_unit / unit_scale`) and capped
    /// at their balance again at payout.
    pub asset_token: Option<Address>,
    pub coverage_per_unit: i128,
    pub unit_scale: i128,
    pub status: ProductStatus,
    /// Sum of coverage of this product's active policies.
    pub exposure: i128,
    pub triggered_at: u64,
    /// Oracle reading that fired the trigger (0 for `ClaimMissing`).
    pub observed_value: i128,
}

#[contracttype]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum PolicyStatus {
    Active,
    Paid,
    Expired,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Policy {
    pub id: u64,
    pub product_id: u64,
    pub holder: Address,
    pub coverage: i128,
    pub premium: i128,
    /// Asset-linked policies: units of `asset_token` insured (else 0).
    pub insured_units: i128,
    pub status: PolicyStatus,
    pub purchased_at: u64,
    pub paid_amount: i128,
}
