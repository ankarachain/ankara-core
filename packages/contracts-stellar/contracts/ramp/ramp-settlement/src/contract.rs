use ankara_common::roles::{require_role, set_role, Role};
use soroban_sdk::{
    contract, contracterror, contractimpl, panic_with_error, symbol_short, token, Address,
    BytesN, Env, String,
};

use crate::records::{self, OffRampDeposit, OnRampRecord, SettlementStatus};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum RampError {
    ZeroAmount = 1,
    ReferenceAlreadyUsed = 2,
    InvalidStatus = 3,
}

/// Direct port of `RampSettlement.sol`. Off-ramp gets real on-chain
/// custody; on-ramp is attestation-only (this contract deliberately holds
/// no mint authority for arbitrary tokens — see the module-level comment
/// on the EVM source). Uses `Role::Settler` in place of `Role::Minter`.
#[contract]
pub struct RampSettlement;

#[contractimpl]
impl RampSettlement {
    pub fn initialize(env: Env, admin: Address, treasury: Address) {
        set_role(&env, Role::Settler, &admin);
        set_role(&env, Role::Pauser, &admin);
        set_role(&env, Role::Manager, &admin);
        set_role(&env, Role::Upgrader, &admin);
        records::init_treasury(&env, &treasury);
    }

    // ─── Off-ramp ─────────────────────────────────────────────────────────

    /// Mirrors `initiateOffRamp()` — caller deposits `amount` of `token`,
    /// pulled via a nested SEP-41 transfer (requires the caller's own auth
    /// in the same call tree).
    pub fn initiate_off_ramp(
        env: Env,
        caller: Address,
        reference_id: BytesN<32>,
        token: Address,
        amount: i128,
        provider_ref: String,
    ) {
        ankara_common::pausable::check_not_paused(&env);
        if amount == 0 {
            panic_with_error!(&env, RampError::ZeroAmount);
        }
        if records::off_ramp_status(&env, &reference_id) != SettlementStatus::None {
            panic_with_error!(&env, RampError::ReferenceAlreadyUsed);
        }

        records::set_off_ramp(
            &env,
            &reference_id,
            &OffRampDeposit {
                depositor: caller.clone(),
                token: token.clone(),
                amount,
                status: SettlementStatus::Pending,
                initiated_at: env.ledger().timestamp(),
            },
        );
        token::TokenClient::new(&env, &token).transfer(&caller, &env.current_contract_address(), &amount);
        env.events().publish(
            (symbol_short!("offinit"), reference_id),
            (caller, token, amount, provider_ref),
        );
    }

    /// Mirrors `confirmOffRampSettlement()` [SETTLER_ROLE].
    pub fn confirm_off_ramp_settlement(env: Env, reference_id: BytesN<32>) {
        require_role(&env, Role::Settler);
        ankara_common::pausable::check_not_paused(&env);
        let mut deposit = records::get_off_ramp(&env, &reference_id)
            .filter(|d| d.status == SettlementStatus::Pending)
            .unwrap_or_else(|| panic_with_error!(&env, RampError::InvalidStatus));

        deposit.status = SettlementStatus::Settled;
        records::set_off_ramp(&env, &reference_id, &deposit);
        let treasury = records::treasury(&env);
        token::TokenClient::new(&env, &deposit.token).transfer(
            &env.current_contract_address(),
            &treasury,
            &deposit.amount,
        );
        env.events().publish(
            (symbol_short!("offsettl"), reference_id),
            (treasury, deposit.amount),
        );
    }

    /// Mirrors `refundOffRamp()` [MANAGER_ROLE].
    pub fn refund_off_ramp(env: Env, reference_id: BytesN<32>) {
        require_role(&env, Role::Manager);
        ankara_common::pausable::check_not_paused(&env);
        let mut deposit = records::get_off_ramp(&env, &reference_id)
            .filter(|d| d.status == SettlementStatus::Pending)
            .unwrap_or_else(|| panic_with_error!(&env, RampError::InvalidStatus));

        deposit.status = SettlementStatus::Refunded;
        records::set_off_ramp(&env, &reference_id, &deposit);
        token::TokenClient::new(&env, &deposit.token).transfer(
            &env.current_contract_address(),
            &deposit.depositor,
            &deposit.amount,
        );
        env.events().publish(
            (symbol_short!("offrfnd"), reference_id),
            (deposit.depositor, deposit.amount),
        );
    }

    // ─── On-ramp ──────────────────────────────────────────────────────────

    /// Mirrors `recordOnRampSettlement()` [SETTLER_ROLE] — attestation
    /// only, no funds move.
    pub fn record_on_ramp_settlement(
        env: Env,
        reference_id: BytesN<32>,
        recipient: Address,
        token: Address,
        amount: i128,
        provider_ref: String,
    ) {
        require_role(&env, Role::Settler);
        ankara_common::pausable::check_not_paused(&env);
        if amount == 0 {
            panic_with_error!(&env, RampError::ZeroAmount);
        }
        if records::on_ramp_status(&env, &reference_id) != SettlementStatus::None {
            panic_with_error!(&env, RampError::ReferenceAlreadyUsed);
        }

        records::set_on_ramp(
            &env,
            &reference_id,
            &OnRampRecord {
                recipient: recipient.clone(),
                token: token.clone(),
                amount,
                status: SettlementStatus::Recorded,
                recorded_at: env.ledger().timestamp(),
            },
        );
        env.events().publish(
            (symbol_short!("oninit"), reference_id),
            (recipient, token, amount, provider_ref),
        );
    }

    // ─── Admin (Role::Manager) ────────────────────────────────────────────

    pub fn set_treasury(env: Env, new_treasury: Address) {
        require_role(&env, Role::Manager);
        records::set_treasury(&env, &new_treasury);
        env.events().publish((symbol_short!("treasury"),), new_treasury);
    }

    pub fn pause(env: Env) {
        ankara_common::pausable::pause(&env);
    }

    pub fn unpause(env: Env) {
        ankara_common::pausable::unpause(&env);
    }

    pub fn is_paused(env: Env) -> bool {
        ankara_common::pausable::is_paused(&env)
    }

    // ─── Views ────────────────────────────────────────────────────────────

    pub fn treasury(env: Env) -> Address {
        records::treasury(&env)
    }

    pub fn get_off_ramp(env: Env, reference_id: BytesN<32>) -> Option<OffRampDeposit> {
        records::get_off_ramp(&env, &reference_id)
    }

    pub fn get_on_ramp(env: Env, reference_id: BytesN<32>) -> Option<OnRampRecord> {
        records::get_on_ramp(&env, &reference_id)
    }

    // ─── Upgrade (Role::Upgrader) ────────────────────────────────────────

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        require_role(&env, Role::Upgrader);
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }
}
