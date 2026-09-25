use ankara_common::roles::{self, require_role, Role};
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address,
    BytesN, Env, Vec,
};

const DAY_IN_LEDGERS: u32 = 17280;
const BUMP_AMOUNT: u32 = 180 * DAY_IN_LEDGERS;
const LIFETIME_THRESHOLD: u32 = BUMP_AMOUNT - DAY_IN_LEDGERS;
const MAX_BATCH: u32 = 50;

/// Same shape as `collateral_vault::CreditScore` — Soroban matches contract
/// types structurally, so this crate doesn't depend on the vault crate
/// (which would pull the vault's exported functions into this wasm).
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CreditScore {
    pub score: u32,
    pub updated_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScoreEntry {
    pub borrower: Address,
    pub score: u32,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ScorerError {
    AlreadyInitialized = 1,
    BatchTooLarge = 2,
}

#[contracttype]
enum DataKey {
    Score(Address),
}

/// Reference credit-score source for `collateral-vault`'s score-based
/// lending — the `manual-oracle` of credit: one trusted Manager (a lender's
/// risk team, a cooperative, a scoring partner's relayer) posts scores.
/// The score scale is whatever the vault's tiers are configured for.
/// Swap in any other contract exposing
/// `credit_score(borrower) -> Option<CreditScore>` for production.
#[contract]
pub struct ManualCreditScorer;

#[contractimpl]
impl ManualCreditScorer {
    pub fn initialize(env: Env, admin: Address) {
        if roles::has_role(&env, Role::Manager) {
            panic_with_error!(&env, ScorerError::AlreadyInitialized);
        }
        roles::init_roles(&env, &admin);
    }

    pub fn set_score(env: Env, borrower: Address, score: u32) {
        require_role(&env, Role::Manager);
        write(&env, &borrower, score);
    }

    pub fn batch_set_scores(env: Env, entries: Vec<ScoreEntry>) {
        require_role(&env, Role::Manager);
        if entries.len() > MAX_BATCH {
            panic_with_error!(&env, ScorerError::BatchTooLarge);
        }
        for e in entries.iter() {
            write(&env, &e.borrower, e.score);
        }
    }

    pub fn remove_score(env: Env, borrower: Address) {
        require_role(&env, Role::Manager);
        env.storage()
            .persistent()
            .remove(&DataKey::Score(borrower.clone()));
        env.events().publish((symbol_short!("rm_score"),), borrower);
    }

    /// The `CreditScoreInterface` method the vault calls.
    pub fn credit_score(env: Env, borrower: Address) -> Option<CreditScore> {
        env.storage().persistent().get(&DataKey::Score(borrower))
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        require_role(&env, Role::Upgrader);
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }
}

fn write(env: &Env, borrower: &Address, score: u32) {
    let key = DataKey::Score(borrower.clone());
    let entry = CreditScore {
        score,
        updated_at: env.ledger().timestamp(),
    };
    env.storage().persistent().set(&key, &entry);
    env.storage()
        .persistent()
        .extend_ttl(&key, LIFETIME_THRESHOLD, BUMP_AMOUNT);
    env.events()
        .publish((symbol_short!("score"), borrower.clone()), score);
}
