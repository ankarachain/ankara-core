use soroban_sdk::{contractclient, contracttype, Address, Env, Vec};

const DAY_IN_LEDGERS: u32 = 17280;
const BUMP_AMOUNT: u32 = 180 * DAY_IN_LEDGERS;
const LIFETIME_THRESHOLD: u32 = BUMP_AMOUNT - DAY_IN_LEDGERS;

/// A borrower's credit/risk score as reported by a score source.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CreditScore {
    pub score: u32,
    pub updated_at: u64,
}

/// Pluggable credit-score source — the lending analogue of
/// `ankara_common::oracle::OracleClient`. Anything implementing this can
/// back `open_scored_loan`: the reference `manual-credit-scorer`, an adapter
/// over `attestation-registry` `CREDIT` claims, a cooperative's membership
/// record, or a third-party scoring service's contract. Credit signals vary
/// by market, so the vault never assumes a particular model — it only maps
/// the returned number onto the tiers configured below.
#[contractclient(name = "CreditScoreClient")]
pub trait CreditScoreInterface {
    fn credit_score(env: Env, borrower: Address) -> Option<CreditScore>;
}

/// One rung of the score → credit mapping. The highest tier whose
/// `min_score` the borrower meets applies.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScoreTier {
    pub min_score: u32,
    /// Unsecured amount this tier may borrow on top of any collateral's
    /// LTV-based allowance (in the borrowed token's units).
    pub credit_limit: i128,
    /// Flat fee on principal, charged at repayment (the vault's return for
    /// taking unsecured risk).
    pub fee_bps: u32,
    /// Longest term this tier may borrow for.
    pub max_term_secs: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScoreConfig {
    pub source: Address,
    pub tiers: Vec<ScoreTier>,
    /// Scores older than this (seconds) are rejected.
    pub max_score_age: u64,
}

/// Extra terms recorded for a loan opened through `open_scored_loan`.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScoredTerms {
    pub score: u32,
    /// Portion of the principal not covered by the collateral allowance.
    pub unsecured_amount: i128,
    pub fee_bps: u32,
    pub due_at: u64,
}

#[contracttype]
enum CreditKey {
    Config,
    Terms(u64),
}

pub fn config(env: &Env) -> Option<ScoreConfig> {
    env.storage().instance().get(&CreditKey::Config)
}

pub fn set_config(env: &Env, cfg: &Option<ScoreConfig>) {
    match cfg {
        Some(c) => env.storage().instance().set(&CreditKey::Config, c),
        None => env.storage().instance().remove(&CreditKey::Config),
    }
}

pub fn terms(env: &Env, loan_id: u64) -> Option<ScoredTerms> {
    env.storage().persistent().get(&CreditKey::Terms(loan_id))
}

pub fn set_terms(env: &Env, loan_id: u64, t: &ScoredTerms) {
    let key = CreditKey::Terms(loan_id);
    env.storage().persistent().set(&key, t);
    env.storage()
        .persistent()
        .extend_ttl(&key, LIFETIME_THRESHOLD, BUMP_AMOUNT);
}

/// Highest tier the score qualifies for (tiers are validated ascending).
pub fn tier_for(cfg: &ScoreConfig, score: u32) -> Option<ScoreTier> {
    let mut best: Option<ScoreTier> = None;
    for t in cfg.tiers.iter() {
        if score >= t.min_score {
            best = Some(t);
        }
    }
    best
}
