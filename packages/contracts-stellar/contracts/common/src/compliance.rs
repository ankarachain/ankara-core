use soroban_sdk::{contractclient, contracttype, panic_with_error, symbol_short, Address, Env};

use crate::errors::CommonError;
use crate::roles::{require_role, Role};

/// Cross-contract interface a compliance-policy contract implements (e.g.
/// `compliance-policy`). Every fungible template consults it — when one is
/// attached — before each transfer, mint and burn, via the shared
/// `fungible` functions, so all templates get the check for free.
///
/// `from = None` is a mint, `to = None` is a burn. Returning `false`
/// rejects the operation with `CommonError::TransferRejected`.
///
/// The policy must not call back into the token from `can_transfer`
/// (Soroban forbids re-entry) — everything it needs is in the arguments.
#[contractclient(name = "CompliancePolicyClient")]
pub trait CompliancePolicyInterface {
    fn can_transfer(
        env: Env,
        token: Address,
        from: Option<Address>,
        to: Option<Address>,
        amount: i128,
    ) -> bool;
}

#[contracttype]
enum ComplianceDataKey {
    Policy,
}

pub fn compliance_policy(env: &Env) -> Option<Address> {
    env.storage().instance().get(&ComplianceDataKey::Policy)
}

/// Attaches (or with `None`, detaches) a compliance policy. Opt-in: tokens
/// without a policy behave exactly as before. Gated by `Role::Manager`,
/// same as `set_identity_verifier`.
pub fn set_compliance_policy(env: &Env, policy: &Option<Address>) {
    require_role(env, Role::Manager);
    match policy {
        Some(addr) => env.storage().instance().set(&ComplianceDataKey::Policy, addr),
        None => env.storage().instance().remove(&ComplianceDataKey::Policy),
    }
    env.events()
        .publish((symbol_short!("policy"),), policy.clone());
}

/// No-op when no policy is attached.
pub fn check_transfer(env: &Env, from: Option<&Address>, to: Option<&Address>, amount: i128) {
    if let Some(policy) = compliance_policy(env) {
        let allowed = CompliancePolicyClient::new(env, &policy).can_transfer(
            &env.current_contract_address(),
            &from.cloned(),
            &to.cloned(),
            &amount,
        );
        if !allowed {
            panic_with_error!(env, CommonError::TransferRejected);
        }
    }
}

/// Issuer-initiated clawback: moves `amount` out of `from`'s balance to
/// `to`, or burns it when `to` is `None`. Only the attached compliance
/// policy contract can authorize this (it calls the token's `clawback`
/// entry point after checking its own admin's auth), so a token with no
/// policy attached can never be clawed back.
pub fn clawback(env: &Env, from: &Address, amount: i128, to: &Option<Address>) {
    let policy = compliance_policy(env)
        .unwrap_or_else(|| panic_with_error!(env, CommonError::NoCompliancePolicy));
    policy.require_auth();
    if amount <= 0 {
        panic_with_error!(env, CommonError::TransferRejected);
    }
    crate::fungible::clawback_balance(env, from, amount, to.as_ref());
    env.events().publish(
        (symbol_short!("clawback"), from.clone()),
        (amount, to.clone()),
    );
}
