use ankara_common::roles::{self, require_role, Role};
use soroban_sdk::{
    contract, contractclient, contractimpl, contracttype, panic_with_error, symbol_short, Address,
    BytesN, Env, Map, Vec,
};

use crate::errors::ReserveError;

const DAY_IN_LEDGERS: u32 = 17280;
const BUMP_AMOUNT: u32 = 365 * DAY_IN_LEDGERS;
const LIFETIME_THRESHOLD: u32 = BUMP_AMOUNT - 30 * DAY_IN_LEDGERS;
const MAX_ATTESTORS: u32 = 20;
const BPS: i128 = 10_000;

/// Every Ankara fungible template exposes `total_supply` (SEP-41 itself
/// doesn't) — that's what backing is measured against.
#[contractclient(name = "SupplyClient")]
pub trait SupplyInterface {
    fn total_supply(env: Env) -> i128;
}

/// A finalized proof-of-reserve report.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReserveReport {
    pub round: u64,
    /// Off-chain reserve, in the asset's own smallest unit (same decimals
    /// as the token), so it compares directly against `total_supply`.
    pub amount: i128,
    pub timestamp: u64,
    /// Number of attestors whose submissions made up this report.
    pub attestor_count: u32,
    /// Hash of the underlying report (bank statement, auditor letter...)
    /// from the submission that set `amount`.
    pub report_hash: BytesN<32>,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Submission {
    pub amount: i128,
    pub report_hash: BytesN<32>,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PendingRound {
    pub round: u64,
    pub opened_at: u64,
    pub submissions: Map<Address, Submission>,
}

#[contracttype]
enum DataKey {
    Asset,
    Attestors,
    Quorum,
    StalenessThreshold,
    Pending,
    LatestRound,
    Report(u64),
}

/// Proof-of-reserve attestation for a reserve-backed asset (a stablecoin,
/// or any token promising 1:1 backing by an off-chain reserve).
///
/// Designated attestors post the current off-chain reserve balance. With a
/// quorum of `n`, a report is finalized once `n` distinct attestors have
/// submitted for the current round, and the **lowest** submitted amount is
/// used — the conservative choice for a solvency proof, so one attestor
/// over-reporting can't inflate the published reserve. `quorum = 1` gives
/// a single-attestor setup shaped like `manual-oracle`.
///
/// A pending round older than the staleness threshold is discarded on the
/// next submission, so a stuck round can't mix fresh and stale figures.
///
/// Anyone can check `is_fully_backed()` (fresh report and reserve >= the
/// token's live `total_supply`) or `collateralization_bps()` before
/// transacting.
#[contract]
pub struct ReserveAttestation;

#[contractimpl]
impl ReserveAttestation {
    pub fn initialize(
        env: Env,
        admin: Address,
        asset: Address,
        attestors: Vec<Address>,
        quorum: u32,
        staleness_threshold: u64,
    ) {
        if roles::has_role(&env, Role::Manager) {
            panic_with_error!(&env, ReserveError::AlreadyInitialized);
        }
        if attestors.len() > MAX_ATTESTORS {
            panic_with_error!(&env, ReserveError::TooManyAttestors);
        }
        if quorum == 0 || quorum > attestors.len() {
            panic_with_error!(&env, ReserveError::InvalidQuorum);
        }
        roles::init_roles(&env, &admin);
        let s = env.storage().instance();
        s.set(&DataKey::Asset, &asset);
        s.set(&DataKey::Attestors, &attestors);
        s.set(&DataKey::Quorum, &quorum);
        s.set(&DataKey::StalenessThreshold, &staleness_threshold);
        s.set(&DataKey::LatestRound, &0u64);
        s.set(&DataKey::Pending, &new_round(&env, 1));
    }

    // ─── Attestor submissions ────────────────────────────────────────────

    /// Submits `amount` for the current round. Returns `true` if this
    /// submission reached quorum and finalized a new report.
    pub fn submit(env: Env, attestor: Address, amount: i128, report_hash: BytesN<32>) -> bool {
        attestor.require_auth();
        if !attestors(&env).contains(&attestor) {
            panic_with_error!(&env, ReserveError::NotAttestor);
        }
        if amount < 0 {
            panic_with_error!(&env, ReserveError::InvalidAmount);
        }
        let now = env.ledger().timestamp();
        let mut pending = pending(&env);

        // Discard a stale, half-filled round.
        if !pending.submissions.is_empty()
            && now.saturating_sub(pending.opened_at) > staleness_threshold(&env)
        {
            pending = new_round(&env, pending.round);
        }
        if pending.submissions.is_empty() {
            pending.opened_at = now;
        }
        if pending.submissions.contains_key(attestor.clone()) {
            panic_with_error!(&env, ReserveError::AlreadySubmitted);
        }
        pending.submissions.set(
            attestor.clone(),
            Submission {
                amount,
                report_hash: report_hash.clone(),
            },
        );
        env.events().publish(
            (symbol_short!("submit"), attestor),
            (pending.round, amount),
        );

        if pending.submissions.len() >= quorum(&env) {
            let mut min: Option<Submission> = None;
            for sub in pending.submissions.values().iter() {
                if min.as_ref().map(|m| sub.amount < m.amount).unwrap_or(true) {
                    min = Some(sub);
                }
            }
            let chosen = min.unwrap();
            let report = ReserveReport {
                round: pending.round,
                amount: chosen.amount,
                timestamp: now,
                attestor_count: pending.submissions.len(),
                report_hash: chosen.report_hash,
            };
            let key = DataKey::Report(report.round);
            env.storage().persistent().set(&key, &report);
            env.storage()
                .persistent()
                .extend_ttl(&key, LIFETIME_THRESHOLD, BUMP_AMOUNT);
            env.storage()
                .instance()
                .set(&DataKey::LatestRound, &report.round);
            env.storage()
                .instance()
                .set(&DataKey::Pending, &new_round(&env, report.round + 1));
            env.events().publish(
                (symbol_short!("reserve"),),
                (report.round, report.amount, report.timestamp),
            );
            true
        } else {
            env.storage().instance().set(&DataKey::Pending, &pending);
            false
        }
    }

    // ─── Admin (Role::Manager) ───────────────────────────────────────────

    pub fn add_attestor(env: Env, attestor: Address) {
        require_role(&env, Role::Manager);
        let mut list = attestors(&env);
        if list.contains(&attestor) {
            panic_with_error!(&env, ReserveError::AttestorExists);
        }
        if list.len() >= MAX_ATTESTORS {
            panic_with_error!(&env, ReserveError::TooManyAttestors);
        }
        list.push_back(attestor.clone());
        env.storage().instance().set(&DataKey::Attestors, &list);
        env.events().publish((symbol_short!("att_add"),), attestor);
    }

    /// Removing an attestor also discards the pending round, so their
    /// in-flight submission can't count toward a later report.
    pub fn remove_attestor(env: Env, attestor: Address) {
        require_role(&env, Role::Manager);
        let mut list = attestors(&env);
        let idx = list
            .first_index_of(&attestor)
            .unwrap_or_else(|| panic_with_error!(&env, ReserveError::NotAttestor));
        if list.len() - 1 < quorum(&env) {
            panic_with_error!(&env, ReserveError::InvalidQuorum);
        }
        list.remove(idx);
        env.storage().instance().set(&DataKey::Attestors, &list);
        let round = pending(&env).round;
        env.storage()
            .instance()
            .set(&DataKey::Pending, &new_round(&env, round));
        env.events().publish((symbol_short!("att_rm"),), attestor);
    }

    pub fn set_quorum(env: Env, new_quorum: u32) {
        require_role(&env, Role::Manager);
        if new_quorum == 0 || new_quorum > attestors(&env).len() {
            panic_with_error!(&env, ReserveError::InvalidQuorum);
        }
        env.storage().instance().set(&DataKey::Quorum, &new_quorum);
        env.events().publish((symbol_short!("quorum"),), new_quorum);
    }

    pub fn set_staleness_threshold(env: Env, new_threshold: u64) {
        require_role(&env, Role::Manager);
        env.storage()
            .instance()
            .set(&DataKey::StalenessThreshold, &new_threshold);
        env.events().publish((symbol_short!("threshold"),), new_threshold);
    }

    // ─── Reads ───────────────────────────────────────────────────────────

    pub fn asset(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Asset).unwrap()
    }

    pub fn attestors(env: Env) -> Vec<Address> {
        attestors(&env)
    }

    pub fn quorum(env: Env) -> u32 {
        quorum(&env)
    }

    pub fn staleness_threshold(env: Env) -> u64 {
        staleness_threshold(&env)
    }

    pub fn pending_round(env: Env) -> PendingRound {
        pending(&env)
    }

    pub fn latest_report(env: Env) -> Option<ReserveReport> {
        latest(&env)
    }

    pub fn get_report(env: Env, round: u64) -> ReserveReport {
        env.storage()
            .persistent()
            .get(&DataKey::Report(round))
            .unwrap_or_else(|| panic_with_error!(&env, ReserveError::ReportNotFound))
    }

    /// `(amount, timestamp)`, both `0` if no report yet — same shape as
    /// `manual-oracle`'s `get_price`.
    pub fn get_reserve(env: Env) -> (i128, u64) {
        match latest(&env) {
            Some(r) => (r.amount, r.timestamp),
            None => (0, 0),
        }
    }

    /// Stale if there's no report yet, or the latest is older than the
    /// staleness threshold.
    pub fn is_stale(env: Env) -> bool {
        match latest(&env) {
            None => true,
            Some(r) => env.ledger().timestamp().saturating_sub(r.timestamp) > staleness_threshold(&env),
        }
    }

    /// The asset's live outstanding supply.
    pub fn outstanding_supply(env: Env) -> i128 {
        SupplyClient::new(&env, &Self::asset(env.clone())).total_supply()
    }

    /// Reserve / outstanding supply, in bps (10_000 = exactly 1:1). Returns
    /// `u32::MAX` when supply is zero. Ignores staleness — pair it with
    /// `is_stale`, or use `is_fully_backed`.
    pub fn collateralization_bps(env: Env) -> u32 {
        let supply = Self::outstanding_supply(env.clone());
        if supply <= 0 {
            return u32::MAX;
        }
        let (reserve, _) = Self::get_reserve(env);
        let bps = reserve.saturating_mul(BPS) / supply;
        if bps > u32::MAX as i128 {
            u32::MAX
        } else {
            bps as u32
        }
    }

    /// Fresh report AND reserve >= outstanding supply.
    pub fn is_fully_backed(env: Env) -> bool {
        if Self::is_stale(env.clone()) {
            return false;
        }
        let (reserve, _) = Self::get_reserve(env.clone());
        reserve >= Self::outstanding_supply(env)
    }

    // ─── Upgrade (Role::Upgrader) ────────────────────────────────────────

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        require_role(&env, Role::Upgrader);
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }
}

fn new_round(env: &Env, round: u64) -> PendingRound {
    PendingRound {
        round,
        opened_at: 0,
        submissions: Map::new(env),
    }
}

fn attestors(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&DataKey::Attestors)
        .unwrap_or_else(|| Vec::new(env))
}

fn quorum(env: &Env) -> u32 {
    env.storage().instance().get(&DataKey::Quorum).unwrap_or(1)
}

fn staleness_threshold(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::StalenessThreshold)
        .unwrap_or(0)
}

fn pending(env: &Env) -> PendingRound {
    env.storage()
        .instance()
        .get(&DataKey::Pending)
        .unwrap_or_else(|| new_round(env, 1))
}

fn latest(env: &Env) -> Option<ReserveReport> {
    let round: u64 = env
        .storage()
        .instance()
        .get(&DataKey::LatestRound)
        .unwrap_or(0);
    if round == 0 {
        return None;
    }
    env.storage().persistent().get(&DataKey::Report(round))
}
