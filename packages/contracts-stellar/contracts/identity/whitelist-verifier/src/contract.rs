use ankara_common::{
    roles::{self, require_role, Role},
    IdentityVerifierInterface,
};
use soroban_sdk::{
    contract, contractimpl, contracttype, panic_with_error, symbol_short, Address, BytesN, Env,
    String, Vec,
};

use crate::errors::WhitelistError;

const DAY_IN_LEDGERS: u32 = 17280;
const RECORD_BUMP_AMOUNT: u32 = 180 * DAY_IN_LEDGERS;
const RECORD_LIFETIME_THRESHOLD: u32 = RECORD_BUMP_AMOUNT - DAY_IN_LEDGERS;
/// Caps a single `batch_verify`/`batch_revoke` call so it stays well inside
/// Soroban's per-transaction read/write entry limits.
const MAX_BATCH: u32 = 50;

/// One verification entry. `expires_at == 0` means the verification never
/// expires; otherwise `is_verified` starts returning `false` once the
/// ledger timestamp passes it — useful for KYC checks that must be renewed
/// periodically without the admin having to remember to revoke them.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VerificationRecord {
    pub verified_at: u64,
    pub expires_at: u64,
}

#[contracttype]
enum DataKey {
    Record(Address),
}

/// Soroban port of `WhitelistVerifier.sol` — a concrete, deployable
/// implementation of `ankara_common::IdentityVerifierInterface`, so a
/// template's `identity_verifier` field has something real to point at out
/// of the box. Admin-controlled allow-list (verify / revoke / batch-verify /
/// is-verified), with optional per-entry expiry on top of the EVM version.
///
/// Like the EVM original, this is a reference/dev implementation: a
/// production deployment would typically point templates at a verifier
/// backed by a real KYC provider, or at `attestation-registry` (which also
/// implements `is_verified`, reading KYC claims posted by trusted attestors).
///
/// Only `Role::Manager` (verify/revoke) and `Role::Upgrader` are used; the
/// other roles are still granted by `init_roles` for consistency with every
/// other Ankara contract.
#[contract]
pub struct WhitelistVerifier;

#[contractimpl]
impl WhitelistVerifier {
    pub fn initialize(env: Env, admin: Address) {
        if roles::has_role(&env, Role::Manager) {
            panic_with_error!(&env, WhitelistError::AlreadyInitialized);
        }
        roles::init_roles(&env, &admin);
    }

    /// Mirrors `verifierName()` on the EVM side.
    pub fn verifier_name(env: Env) -> String {
        String::from_str(&env, "WhitelistVerifier")
    }

    pub fn admin(env: Env) -> Address {
        roles::get_role(&env, Role::Manager)
    }

    // ─── Writes (Role::Manager) ──────────────────────────────────────────

    /// Verifies `account` with no expiry. Mirrors `verifyIdentity()`.
    pub fn verify(env: Env, account: Address) {
        require_role(&env, Role::Manager);
        write_record(&env, &account, 0);
    }

    /// Verifies `account` until `expires_at` (a ledger timestamp, seconds).
    pub fn verify_until(env: Env, account: Address, expires_at: u64) {
        require_role(&env, Role::Manager);
        if expires_at != 0 && expires_at <= env.ledger().timestamp() {
            panic_with_error!(&env, WhitelistError::InvalidExpiry);
        }
        write_record(&env, &account, expires_at);
    }

    /// Mirrors `revokeIdentity()`. Revoking an unverified account is a no-op
    /// apart from the event, matching the EVM version.
    pub fn revoke(env: Env, account: Address) {
        require_role(&env, Role::Manager);
        remove_record(&env, &account);
    }

    /// Mirrors `batchVerify()` — capped at 50 accounts per call.
    pub fn batch_verify(env: Env, accounts: Vec<Address>) {
        require_role(&env, Role::Manager);
        if accounts.len() > MAX_BATCH {
            panic_with_error!(&env, WhitelistError::BatchTooLarge);
        }
        for account in accounts.iter() {
            write_record(&env, &account, 0);
        }
    }

    pub fn batch_revoke(env: Env, accounts: Vec<Address>) {
        require_role(&env, Role::Manager);
        if accounts.len() > MAX_BATCH {
            panic_with_error!(&env, WhitelistError::BatchTooLarge);
        }
        for account in accounts.iter() {
            remove_record(&env, &account);
        }
    }

    /// Hands the allow-list over to a new admin (e.g. a multisig or a KYC
    /// provider's operational key). Requires the current admin's auth.
    pub fn transfer_admin(env: Env, new_admin: Address) {
        let old = require_role(&env, Role::Manager);
        roles::set_role(&env, Role::Manager, &new_admin);
        roles::set_role(&env, Role::Upgrader, &new_admin);
        env.events()
            .publish((symbol_short!("admin"),), (old, new_admin));
    }

    // ─── Reads ───────────────────────────────────────────────────────────

    pub fn get_record(env: Env, account: Address) -> Option<VerificationRecord> {
        env.storage().persistent().get(&DataKey::Record(account))
    }

    // ─── Upgrade (Role::Upgrader) ────────────────────────────────────────

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        require_role(&env, Role::Upgrader);
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }
}

#[contractimpl]
impl IdentityVerifierInterface for WhitelistVerifier {
    /// The single method every template calls through `IdentityVerifierClient`.
    fn is_verified(env: Env, account: Address) -> bool {
        let key = DataKey::Record(account);
        match env.storage().persistent().get::<_, VerificationRecord>(&key) {
            None => false,
            Some(record) => {
                env.storage().persistent().extend_ttl(
                    &key,
                    RECORD_LIFETIME_THRESHOLD,
                    RECORD_BUMP_AMOUNT,
                );
                record.expires_at == 0 || env.ledger().timestamp() < record.expires_at
            }
        }
    }
}

fn write_record(env: &Env, account: &Address, expires_at: u64) {
    let key = DataKey::Record(account.clone());
    let record = VerificationRecord {
        verified_at: env.ledger().timestamp(),
        expires_at,
    };
    env.storage().persistent().set(&key, &record);
    env.storage()
        .persistent()
        .extend_ttl(&key, RECORD_LIFETIME_THRESHOLD, RECORD_BUMP_AMOUNT);
    env.events().publish(
        (symbol_short!("verified"), account.clone()),
        (record.verified_at, expires_at),
    );
}

fn remove_record(env: &Env, account: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::Record(account.clone()));
    env.events().publish(
        (symbol_short!("revoked"), account.clone()),
        env.ledger().timestamp(),
    );
}
