use soroban_sdk::{contractclient, contracttype, panic_with_error, Address, Env};

use crate::errors::CommonError;
use crate::roles::{require_role, Role};

/// Cross-contract interface implemented by identity-verifier contracts
/// (e.g. `whitelist-verifier`), mirroring `IIdentityVerifier.sol`'s single
/// `isVerified(address) -> bool` method. Soroban contracts call each other
/// through a generated client (`IdentityVerifierClient`) rather than
/// Solidity's direct interface-typed call.
#[contractclient(name = "IdentityVerifierClient")]
pub trait IdentityVerifierInterface {
    fn is_verified(env: Env, account: Address) -> bool;
}

#[contracttype]
enum VerifierDataKey {
    Verifier,
}

/// Sets the verifier directly with no auth check — called once from
/// `initialize()`, mirroring the constructor-time direct assignment
/// `_identityVerifier = IIdentityVerifier(verifier_)` on
/// `AnkaraChainBaseToken.sol` (not routed through the gated setter below).
pub fn init_identity_verifier(env: &Env, verifier: &Option<Address>) {
    if let Some(addr) = verifier {
        env.storage().instance().set(&VerifierDataKey::Verifier, addr);
    }
}

/// Sets the pluggable identity verifier. `None` means "open" (no KYC gate),
/// matching `address(0)` on `AnkaraChainBaseToken.sol`. Gated by
/// `Role::Manager`, mirroring `setIdentityVerifier()` [MANAGER_ROLE].
pub fn set_identity_verifier(env: &Env, verifier: &Option<Address>) {
    require_role(env, Role::Manager);
    match verifier {
        Some(addr) => env.storage().instance().set(&VerifierDataKey::Verifier, addr),
        None => env.storage().instance().remove(&VerifierDataKey::Verifier),
    }
}

pub fn identity_verifier(env: &Env) -> Option<Address> {
    env.storage().instance().get(&VerifierDataKey::Verifier)
}

/// Reverts (mirrors `NotVerified(account)`) if a verifier is configured and
/// it reports `account` as not verified. No-ops when no verifier is set.
pub fn check_verified(env: &Env, account: &Address) {
    if let Some(verifier) = identity_verifier(env) {
        let client = IdentityVerifierClient::new(env, &verifier);
        if !client.is_verified(account) {
            panic_with_error!(env, CommonError::NotVerified);
        }
    }
}
