use soroban_sdk::{contracttype, panic_with_error, Address, Env};

use crate::errors::CommonError;

/// Soroban has no OZ-style bitmap `AccessControl`. Each role instead stores
/// a single `Address` in contract-instance storage, matching the four roles
/// used by `AnkaraChainBaseToken.sol` (MINTER/PAUSER/MANAGER/UPGRADER).
/// Enforcement is `require_auth()` on the stored address rather than a
/// mapping lookup against `msg.sender`.
#[contracttype]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum Role {
    Minter,
    Pauser,
    Manager,
    Upgrader,
    /// Used by `ramp-settlement` in place of `Minter` (SETTLER_ROLE on the
    /// EVM side) — settlement contracts confirm/record settlements, they
    /// never mint.
    Settler,
}

#[contracttype]
enum RoleDataKey {
    RoleAddr(Role),
}

/// Grants all four roles to `admin` — called once from each template's
/// `initialize()`, mirroring `__AnkaraChainBaseToken_init`'s
/// `_grantRole(...)` calls all pointing at the same `admin_` address.
pub fn init_roles(env: &Env, admin: &Address) {
    set_role(env, Role::Minter, admin);
    set_role(env, Role::Pauser, admin);
    set_role(env, Role::Manager, admin);
    set_role(env, Role::Upgrader, admin);
}

pub fn set_role(env: &Env, role: Role, addr: &Address) {
    env.storage()
        .instance()
        .set(&RoleDataKey::RoleAddr(role), addr);
}

pub fn get_role(env: &Env, role: Role) -> Address {
    env.storage()
        .instance()
        .get(&RoleDataKey::RoleAddr(role))
        .unwrap_or_else(|| panic_with_error!(env, CommonError::NotInitialized))
}

pub fn has_role(env: &Env, role: Role) -> bool {
    env.storage()
        .instance()
        .has(&RoleDataKey::RoleAddr(role))
}

/// Loads the address holding `role` and requires its authorization,
/// the Soroban analogue of Solidity's `onlyRole(ROLE)` modifier.
pub fn require_role(env: &Env, role: Role) -> Address {
    let addr = get_role(env, role);
    addr.require_auth();
    addr
}
