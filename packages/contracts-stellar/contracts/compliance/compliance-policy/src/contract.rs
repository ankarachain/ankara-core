use ankara_common::{
    roles::{self, require_role, Role},
    CompliancePolicyInterface,
};
use soroban_sdk::{
    contract, contractclient, contractimpl, contracttype, panic_with_error, symbol_short, Address,
    BytesN, Env, String,
};

use crate::errors::PolicyError;

const DAY_IN_LEDGERS: u32 = 17280;
const BUMP_AMOUNT: u32 = 180 * DAY_IN_LEDGERS;
const LIFETIME_THRESHOLD: u32 = BUMP_AMOUNT - DAY_IN_LEDGERS;

/// The token-side entry point this policy drives for clawbacks — every
/// fungible Ankara template exposes it (see `ankara_common::compliance`).
#[contractclient(name = "ClawbackTokenClient")]
pub trait ClawbackToken {
    fn clawback(env: Env, from: Address, amount: i128, to: Option<Address>);
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FreezeRecord {
    pub frozen_at: u64,
    /// Why — e.g. a court-order reference or case ID. Kept on-chain so the
    /// freeze is auditable.
    pub reason: String,
}

#[contracttype]
enum DataKey {
    Frozen(Address),
    /// `0` = no per-transfer cap.
    MaxTransferAmount,
}

/// Opt-in compliance policy for Ankara fungible templates. Attach it to a
/// token with `set_compliance_policy(Some(policy))` (token Manager role);
/// from then on every transfer, mint and burn on that token is checked
/// against this policy, and the policy admin can claw balances back.
///
/// Rules:
/// - **Freeze** — a frozen account can't send, receive, or burn.
/// - **Per-transfer cap** — optional maximum amount for holder-to-holder
///   transfers (mints and burns are not capped).
/// - **Clawback** — forced burn, or forced transfer to a recovery address,
///   of a holder's balance; works even while the holder is frozen.
///
/// One policy instance can serve every token an issuer runs; freezes apply
/// to all tokens pointed at it. Deploy separate instances for separate
/// rule sets. The identity-verifier gate still applies independently.
#[contract]
pub struct CompliancePolicy;

#[contractimpl]
impl CompliancePolicy {
    pub fn initialize(env: Env, admin: Address) {
        if roles::has_role(&env, Role::Manager) {
            panic_with_error!(&env, PolicyError::AlreadyInitialized);
        }
        roles::init_roles(&env, &admin);
    }

    pub fn admin(env: Env) -> Address {
        roles::get_role(&env, Role::Manager)
    }

    // ─── Freeze (Role::Manager) ──────────────────────────────────────────

    pub fn freeze(env: Env, account: Address, reason: String) {
        require_role(&env, Role::Manager);
        let key = DataKey::Frozen(account.clone());
        let record = FreezeRecord {
            frozen_at: env.ledger().timestamp(),
            reason: reason.clone(),
        };
        env.storage().persistent().set(&key, &record);
        env.storage()
            .persistent()
            .extend_ttl(&key, LIFETIME_THRESHOLD, BUMP_AMOUNT);
        env.events()
            .publish((symbol_short!("frozen"), account), reason);
    }

    pub fn unfreeze(env: Env, account: Address) {
        require_role(&env, Role::Manager);
        env.storage()
            .persistent()
            .remove(&DataKey::Frozen(account.clone()));
        env.events()
            .publish((symbol_short!("unfrozen"), account), env.ledger().timestamp());
    }

    pub fn is_frozen(env: Env, account: Address) -> bool {
        env.storage().persistent().has(&DataKey::Frozen(account))
    }

    pub fn freeze_record(env: Env, account: Address) -> Option<FreezeRecord> {
        env.storage().persistent().get(&DataKey::Frozen(account))
    }

    // ─── Transfer rules (Role::Manager) ──────────────────────────────────

    /// `0` removes the cap.
    pub fn set_max_transfer_amount(env: Env, amount: i128) {
        require_role(&env, Role::Manager);
        if amount < 0 {
            panic_with_error!(&env, PolicyError::InvalidAmount);
        }
        env.storage()
            .instance()
            .set(&DataKey::MaxTransferAmount, &amount);
        env.events().publish((symbol_short!("maxxfer"),), amount);
    }

    pub fn max_transfer_amount(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::MaxTransferAmount)
            .unwrap_or(0)
    }

    // ─── Clawback (Role::Manager) ────────────────────────────────────────

    /// Claws `amount` of `token` back from `from` — burned when `to` is
    /// `None`, otherwise moved to `to`. `token` must have this policy
    /// attached; the token verifies that the call comes from its policy.
    pub fn clawback(env: Env, token: Address, from: Address, amount: i128, to: Option<Address>) {
        require_role(&env, Role::Manager);
        if amount <= 0 {
            panic_with_error!(&env, PolicyError::InvalidAmount);
        }
        ClawbackTokenClient::new(&env, &token).clawback(&from, &amount, &to);
        env.events()
            .publish((symbol_short!("clawback"), token, from), (amount, to));
    }

    // ─── Upgrade (Role::Upgrader) ────────────────────────────────────────

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        require_role(&env, Role::Upgrader);
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }
}

#[contractimpl]
impl CompliancePolicyInterface for CompliancePolicy {
    fn can_transfer(
        env: Env,
        _token: Address,
        from: Option<Address>,
        to: Option<Address>,
        amount: i128,
    ) -> bool {
        let frozen = |a: &Option<Address>| match a {
            Some(addr) => env.storage().persistent().has(&DataKey::Frozen(addr.clone())),
            None => false,
        };
        if frozen(&from) || frozen(&to) {
            return false;
        }
        if from.is_some() && to.is_some() {
            let cap: i128 = env
                .storage()
                .instance()
                .get(&DataKey::MaxTransferAmount)
                .unwrap_or(0);
            if cap > 0 && amount > cap {
                return false;
            }
        }
        true
    }
}
