use ankara_common::{
    roles::{self, require_role, Role},
    IdentityVerifierInterface,
};
use soroban_sdk::{
    contract, contractimpl, panic_with_error, symbol_short, Address, BytesN, Env, String, Symbol,
    Vec,
};

use crate::errors::AttestationError;
use crate::storage::{self, Attestation, Subject};

/// Max entries returned by one `history` page.
const MAX_PAGE: u32 = 50;
/// `latest` walks a subject's history newest-first looking for a claim that
/// is neither revoked nor expired; the walk is capped so a long run of
/// revoked entries can't blow the read budget.
const MAX_LATEST_SCAN: u32 = 50;

/// Generic on-chain attestation registry: an authorized attestor records a
/// typed claim about a subject (an account or an asset), and anyone can
/// read the current or historical claims for that subject.
///
/// One contract serves every "someone trusted records a fact that others
/// later verify" need in Ankara instead of a bespoke contract per use case:
///
/// | Use case                   | subject          | claim_type | value / data                 |
/// |----------------------------|------------------|------------|------------------------------|
/// | KYC status                 | `Account(addr)`  | `KYC`      | tier (`>0` = verified)        |
/// | Land-title chain of custody| `Asset(asset_id)`| `TITLE`    | — / new owner + deed hash     |
/// | Delivery / harvest proof   | `Asset(asset_id)`| `DELIVERY` | quantity / receipt hash       |
/// | Credit / reputation signal | `Account(addr)`  | `CREDIT`   | score / scoring-model ref     |
///
/// It also implements `IdentityVerifierInterface`, so any template can point
/// its `identity_verifier` straight at this registry: `is_verified(account)`
/// is true when the account's latest valid claim of the configured
/// verifier claim type (default `KYC`) has `value > 0`.
///
/// Attestors are an allow-list managed by `Role::Manager`. History is
/// append-only: a revoked claim stays readable with `revoked = true`.
#[contract]
pub struct AttestationRegistry;

#[contractimpl]
impl AttestationRegistry {
    pub fn initialize(env: Env, admin: Address) {
        if roles::has_role(&env, Role::Manager) {
            panic_with_error!(&env, AttestationError::AlreadyInitialized);
        }
        roles::init_roles(&env, &admin);
    }

    pub fn admin(env: Env) -> Address {
        roles::get_role(&env, Role::Manager)
    }

    // ─── Attestor management (Role::Manager) ─────────────────────────────

    pub fn add_attestor(env: Env, attestor: Address) {
        require_role(&env, Role::Manager);
        storage::set_attestor(&env, &attestor, true);
        env.events().publish((symbol_short!("att_add"),), attestor);
    }

    pub fn remove_attestor(env: Env, attestor: Address) {
        require_role(&env, Role::Manager);
        storage::set_attestor(&env, &attestor, false);
        env.events().publish((symbol_short!("att_rm"),), attestor);
    }

    pub fn is_attestor(env: Env, attestor: Address) -> bool {
        storage::is_attestor(&env, &attestor)
    }

    /// Which claim type `is_verified` checks. Defaults to `KYC`.
    pub fn set_verifier_claim_type(env: Env, claim_type: Symbol) {
        require_role(&env, Role::Manager);
        storage::set_verifier_claim_type(&env, &claim_type);
    }

    pub fn verifier_claim_type(env: Env) -> Symbol {
        storage::verifier_claim_type(&env)
    }

    // ─── Attesting ───────────────────────────────────────────────────────

    /// Records a claim and returns its id. `expires_at` is a ledger
    /// timestamp in seconds, or `0` for "never expires".
    pub fn attest(
        env: Env,
        attestor: Address,
        subject: Subject,
        claim_type: Symbol,
        value: i128,
        data: String,
        expires_at: u64,
    ) -> u64 {
        attestor.require_auth();
        if !storage::is_attestor(&env, &attestor) {
            panic_with_error!(&env, AttestationError::NotAttestor);
        }
        let now = env.ledger().timestamp();
        if expires_at != 0 && expires_at <= now {
            panic_with_error!(&env, AttestationError::InvalidExpiry);
        }

        let id = storage::next_id(&env);
        let record = Attestation {
            id,
            subject: subject.clone(),
            claim_type: claim_type.clone(),
            attestor: attestor.clone(),
            value,
            data,
            timestamp: now,
            expires_at,
            revoked: false,
        };
        storage::set(&env, &record);
        storage::push_claim(&env, &subject, &claim_type, id);

        env.events().publish(
            (symbol_short!("attested"), subject, claim_type),
            (id, attestor, value),
        );
        id
    }

    /// Marks a claim revoked. Callable by the attestor who posted it, or by
    /// the Manager (e.g. to clean up after a compromised attestor key).
    pub fn revoke(env: Env, caller: Address, attestation_id: u64) {
        caller.require_auth();
        let mut record = storage::get(&env, attestation_id);
        if record.revoked {
            panic_with_error!(&env, AttestationError::AlreadyRevoked);
        }
        if caller != record.attestor && caller != roles::get_role(&env, Role::Manager) {
            panic_with_error!(&env, AttestationError::NotClaimAttestor);
        }
        record.revoked = true;
        storage::set(&env, &record);
        env.events().publish(
            (symbol_short!("revoked"), record.subject, record.claim_type),
            (attestation_id, caller),
        );
    }

    // ─── Reads ───────────────────────────────────────────────────────────

    pub fn get_attestation(env: Env, attestation_id: u64) -> Attestation {
        storage::get(&env, attestation_id)
    }

    /// Total attestations ever recorded (revoked ones included).
    pub fn attestation_count(env: Env) -> u64 {
        storage::total(&env)
    }

    /// Number of claims ever recorded for `(subject, claim_type)`.
    pub fn claim_count(env: Env, subject: Subject, claim_type: Symbol) -> u32 {
        storage::claim_count(&env, &subject, &claim_type)
    }

    /// Oldest-first page of `(subject, claim_type)` history, revoked and
    /// expired entries included. `limit` is capped at 50.
    pub fn history(
        env: Env,
        subject: Subject,
        claim_type: Symbol,
        start: u32,
        limit: u32,
    ) -> Vec<Attestation> {
        if limit > MAX_PAGE {
            panic_with_error!(&env, AttestationError::PageTooLarge);
        }
        let count = storage::claim_count(&env, &subject, &claim_type);
        let mut out = Vec::new(&env);
        let end = start.saturating_add(limit).min(count);
        let mut i = start;
        while i < end {
            let id = storage::claim_at(&env, &subject, &claim_type, i);
            out.push_back(storage::get(&env, id));
            i += 1;
        }
        out
    }

    /// The most recent claim of this type that is neither revoked nor
    /// expired, if any.
    pub fn latest(env: Env, subject: Subject, claim_type: Symbol) -> Option<Attestation> {
        latest_valid(&env, &subject, &claim_type)
    }

    pub fn has_valid_claim(env: Env, subject: Subject, claim_type: Symbol) -> bool {
        latest_valid(&env, &subject, &claim_type).is_some()
    }

    // ─── Upgrade (Role::Upgrader) ────────────────────────────────────────

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        require_role(&env, Role::Upgrader);
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }
}

#[contractimpl]
impl IdentityVerifierInterface for AttestationRegistry {
    fn is_verified(env: Env, account: Address) -> bool {
        let claim_type = storage::verifier_claim_type(&env);
        match latest_valid(&env, &Subject::Account(account), &claim_type) {
            Some(a) => a.value > 0,
            None => false,
        }
    }
}

fn latest_valid(env: &Env, subject: &Subject, claim_type: &Symbol) -> Option<Attestation> {
    let count = storage::claim_count(env, subject, claim_type);
    let now = env.ledger().timestamp();
    let floor = count.saturating_sub(MAX_LATEST_SCAN);
    let mut i = count;
    while i > floor {
        i -= 1;
        let id = storage::claim_at(env, subject, claim_type, i);
        let a = storage::get(env, id);
        if a.is_valid(now) {
            return Some(a);
        }
    }
    None
}
