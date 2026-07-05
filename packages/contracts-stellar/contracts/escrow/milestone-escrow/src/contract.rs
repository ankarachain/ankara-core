use ankara_common::{
    roles::{self, require_role, Role},
    verifier,
};
use soroban_sdk::{
    contract, contractimpl, panic_with_error, symbol_short, token, Address, BytesN, Env, Vec,
};

use crate::deal::{self, Milestone, MilestoneStatus};
use crate::errors::EscrowError;

/// Direct port of `MilestoneEscrow.sol` — one deal per deployed instance.
/// Uses `ankara_common::roles` for Pauser/Manager/Upgrader (no Minter role
/// needed here) and `ankara_common::verifier` for the optional KYC hook,
/// same as every other template.
#[contract]
pub struct MilestoneEscrow;

#[contractimpl]
impl MilestoneEscrow {
    #[allow(clippy::too_many_arguments)]
    pub fn initialize(
        env: Env,
        admin: Address,
        payer: Address,
        payee: Address,
        arbiter: Option<Address>,
        token: Address,
        identity_verifier: Option<Address>,
        timelock_duration: u64,
        amounts: Vec<i128>,
        description_hashes: Vec<BytesN<32>>,
    ) {
        if payer == payee {
            panic_with_error!(&env, EscrowError::SamePartyNotAllowed);
        }
        if amounts.is_empty() {
            panic_with_error!(&env, EscrowError::NoMilestones);
        }
        if amounts.len() != description_hashes.len() {
            panic_with_error!(&env, EscrowError::LengthMismatch);
        }
        for amount in amounts.iter() {
            if amount == 0 {
                panic_with_error!(&env, EscrowError::ZeroAmount);
            }
        }

        roles::init_roles(&env, &admin);
        ankara_common::verifier::init_identity_verifier(&env, &identity_verifier);

        deal::init_deal(
            &env,
            payer,
            payee,
            arbiter,
            token,
            timelock_duration,
            amounts,
            description_hashes,
        );
    }

    // ─── Funding ──────────────────────────────────────────────────────────

    /// Funds a single milestone (payer only) via a nested SEP-41 transfer —
    /// requires the payer's own auth in the same call tree. Milestones are
    /// funded independently rather than the whole deal at once, so the payer
    /// can pay in installments instead of depositing the full total up front.
    pub fn fund(env: Env, caller: Address, milestone_id: u32) {
        caller.require_auth();
        ankara_common::pausable::check_not_paused(&env);
        if caller != deal::payer(&env) {
            panic_with_error!(&env, EscrowError::NotPayer);
        }
        let mut m = deal::get_milestone(&env, milestone_id);
        if m.funded {
            panic_with_error!(&env, EscrowError::AlreadyFunded);
        }
        if m.status != MilestoneStatus::Pending {
            panic_with_error!(&env, EscrowError::InvalidMilestoneStatus);
        }
        verifier::check_verified(&env, &caller);

        m.funded = true;
        let amount = m.amount;
        deal::set_milestone(&env, milestone_id, &m);
        token::TokenClient::new(&env, &deal::token(&env)).transfer(
            &caller,
            &env.current_contract_address(),
            &amount,
        );
        env.events()
            .publish((symbol_short!("funded"), milestone_id), amount);
    }

    // ─── Milestone lifecycle ──────────────────────────────────────────────

    pub fn mark_delivered(env: Env, caller: Address, milestone_id: u32) {
        ankara_common::pausable::check_not_paused(&env);
        caller.require_auth();
        if caller != deal::payee(&env) {
            panic_with_error!(&env, EscrowError::NotPayee);
        }
        let mut m = deal::get_milestone(&env, milestone_id);
        if !m.funded {
            panic_with_error!(&env, EscrowError::NotFunded);
        }
        if m.status != MilestoneStatus::Pending {
            panic_with_error!(&env, EscrowError::InvalidMilestoneStatus);
        }
        m.status = MilestoneStatus::Delivered;
        m.delivered_at = env.ledger().timestamp();
        deal::set_milestone(&env, milestone_id, &m);
        env.events()
            .publish((symbol_short!("delivered"), milestone_id), env.ledger().timestamp());
    }

    pub fn approve_milestone(env: Env, caller: Address, milestone_id: u32) {
        ankara_common::pausable::check_not_paused(&env);
        caller.require_auth();
        if caller != deal::payer(&env) {
            panic_with_error!(&env, EscrowError::NotPayer);
        }
        let m = deal::get_milestone(&env, milestone_id);
        if m.status != MilestoneStatus::Delivered {
            panic_with_error!(&env, EscrowError::InvalidMilestoneStatus);
        }
        Self::release(&env, milestone_id, m, false);
    }

    pub fn raise_dispute(env: Env, caller: Address, milestone_id: u32) {
        ankara_common::pausable::check_not_paused(&env);
        caller.require_auth();
        let payer = deal::payer(&env);
        let payee = deal::payee(&env);
        if caller != payer && caller != payee {
            panic_with_error!(&env, EscrowError::NotParty);
        }
        let mut m = deal::get_milestone(&env, milestone_id);
        if m.status != MilestoneStatus::Delivered {
            panic_with_error!(&env, EscrowError::InvalidMilestoneStatus);
        }
        m.status = MilestoneStatus::Disputed;
        deal::set_milestone(&env, milestone_id, &m);
        env.events()
            .publish((symbol_short!("disputed"), milestone_id), caller);
    }

    pub fn resolve_dispute(env: Env, caller: Address, milestone_id: u32, release_to_payee: bool) {
        ankara_common::pausable::check_not_paused(&env);
        caller.require_auth();
        let arbiter = deal::arbiter(&env);
        if arbiter.is_none() || Some(caller.clone()) != arbiter {
            panic_with_error!(&env, EscrowError::NotArbiter);
        }
        let m = deal::get_milestone(&env, milestone_id);
        if m.status != MilestoneStatus::Disputed {
            panic_with_error!(&env, EscrowError::InvalidMilestoneStatus);
        }
        if release_to_payee {
            Self::release(&env, milestone_id, m, false);
        } else {
            let mut m = m;
            m.status = MilestoneStatus::Refunded;
            let amount = m.amount;
            deal::set_milestone(&env, milestone_id, &m);
            token::TokenClient::new(&env, &deal::token(&env)).transfer(
                &env.current_contract_address(),
                &deal::payer(&env),
                &amount,
            );
            env.events()
                .publish((symbol_short!("refunded"), milestone_id), amount);
        }
        env.events()
            .publish((symbol_short!("resolved"), milestone_id), release_to_payee);
    }

    /// Mirrors `claimTimelockRelease()` — callable by anyone once eligible.
    pub fn claim_timelock_release(env: Env, milestone_id: u32) {
        ankara_common::pausable::check_not_paused(&env);
        let m = deal::get_milestone(&env, milestone_id);
        if m.status != MilestoneStatus::Delivered {
            panic_with_error!(&env, EscrowError::InvalidMilestoneStatus);
        }
        let timelock = deal::timelock_duration(&env);
        if env.ledger().timestamp() < m.delivered_at + timelock {
            panic_with_error!(&env, EscrowError::TimelockNotElapsed);
        }
        Self::release(&env, milestone_id, m, true);
    }

    // ─── Mutual cancellation ──────────────────────────────────────────────

    pub fn vote_cancel(env: Env, caller: Address) {
        ankara_common::pausable::check_not_paused(&env);
        caller.require_auth();
        let payer = deal::payer(&env);
        let payee = deal::payee(&env);
        if caller != payer && caller != payee {
            panic_with_error!(&env, EscrowError::NotParty);
        }
        if deal::is_cancelled(&env) {
            panic_with_error!(&env, EscrowError::AlreadyCancelled);
        }
        deal::set_cancel_vote(&env, caller == payer);
        env.events().publish((symbol_short!("cancelvot"),), caller);

        if deal::cancel_vote(&env, true) && deal::cancel_vote(&env, false) {
            Self::execute_cancel(&env);
        }
    }

    fn execute_cancel(env: &Env) {
        deal::set_cancelled(env, true);
        let mut refund_amount: i128 = 0;
        for i in 0..deal::milestone_count(env) {
            let mut m = deal::get_milestone(env, i);
            if m.status == MilestoneStatus::Pending {
                if m.funded {
                    refund_amount += m.amount;
                }
                m.status = MilestoneStatus::Refunded;
                deal::set_milestone(env, i, &m);
            }
        }
        if refund_amount > 0 {
            token::TokenClient::new(env, &deal::token(env)).transfer(
                &env.current_contract_address(),
                &deal::payer(env),
                &refund_amount,
            );
        }
        env.events()
            .publish((symbol_short!("cancelled"),), refund_amount);
    }

    // ─── Admin (Role::Manager) ────────────────────────────────────────────

    pub fn set_arbiter(env: Env, new_arbiter: Option<Address>) {
        require_role(&env, Role::Manager);
        deal::set_arbiter(&env, new_arbiter.clone());
        env.events().publish((symbol_short!("arbiter"),), new_arbiter);
    }

    pub fn set_identity_verifier(env: Env, new_verifier: Option<Address>) {
        verifier::set_identity_verifier(&env, &new_verifier);
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

    pub fn payer(env: Env) -> Address {
        deal::payer(&env)
    }

    pub fn payee(env: Env) -> Address {
        deal::payee(&env)
    }

    pub fn arbiter(env: Env) -> Option<Address> {
        deal::arbiter(&env)
    }

    pub fn token(env: Env) -> Address {
        deal::token(&env)
    }

    pub fn timelock_duration(env: Env) -> u64 {
        deal::timelock_duration(&env)
    }

    pub fn total_amount(env: Env) -> i128 {
        deal::total_amount(&env)
    }

    /// True once every milestone has been individually funded — funding now
    /// happens per milestone (installments), not once for the whole deal.
    pub fn funded(env: Env) -> bool {
        deal::all_funded(&env)
    }

    pub fn cancelled(env: Env) -> bool {
        deal::is_cancelled(&env)
    }

    pub fn identity_verifier(env: Env) -> Option<Address> {
        verifier::identity_verifier(&env)
    }

    pub fn milestone_count(env: Env) -> u32 {
        deal::milestone_count(&env)
    }

    pub fn get_milestone(env: Env, milestone_id: u32) -> Milestone {
        deal::get_milestone(&env, milestone_id)
    }

    pub fn remaining_balance(env: Env) -> i128 {
        token::TokenClient::new(&env, &deal::token(&env)).balance(&env.current_contract_address())
    }

    // ─── Internal ─────────────────────────────────────────────────────────

    /// Checks-effects-interactions: status flips to `Released` before the
    /// transfer fires, mirroring `_release()`.
    fn release(env: &Env, milestone_id: u32, mut m: Milestone, via_timelock: bool) {
        verifier::check_verified(env, &deal::payee(env));
        m.status = MilestoneStatus::Released;
        let amount = m.amount;
        deal::set_milestone(env, milestone_id, &m);
        token::TokenClient::new(env, &deal::token(env)).transfer(
            &env.current_contract_address(),
            &deal::payee(env),
            &amount,
        );
        env.events().publish(
            (symbol_short!("released"), milestone_id),
            (amount, via_timelock),
        );
    }

    // ─── Upgrade (Role::Upgrader) ────────────────────────────────────────

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        require_role(&env, Role::Upgrader);
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }
}
