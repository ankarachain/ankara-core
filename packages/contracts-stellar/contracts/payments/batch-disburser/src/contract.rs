use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, token,
    Address, Env, String, Vec,
};

/// Keeps one call inside Soroban's per-transaction resource limits (each
/// payment is a cross-contract token transfer touching two balance
/// entries). The SDK chunks larger lists automatically.
pub const MAX_PAYMENTS: u32 = 100;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum DisburseError {
    EmptyBatch = 1,
    BatchTooLarge = 2,
    InvalidAmount = 3,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Payment {
    pub recipient: Address,
    pub amount: i128,
}

/// Payroll / batch disbursement: one authorized signer pays many recipients
/// in a single transaction — payroll, cooperative distributions, relief
/// payouts. Stateless (no admin, no custody): funds move straight from the
/// payer to each recipient via the token's own `transfer`, so the token's
/// identity-verifier and compliance checks still apply per recipient.
///
/// The batch is atomic — if any single transfer fails (unverified
/// recipient, insufficient balance) the whole batch reverts, so a payroll
/// run is never half-paid.
#[contract]
pub struct BatchDisburser;

#[contractimpl]
impl BatchDisburser {
    /// Pays every `(recipient, amount)` in `payments` from `payer`, in
    /// `token`. `reference` (e.g. "payroll-2026-09") is emitted in the
    /// event for reconciliation. Returns the total paid.
    pub fn disburse(
        env: Env,
        payer: Address,
        token: Address,
        payments: Vec<Payment>,
        reference: String,
    ) -> i128 {
        payer.require_auth();
        if payments.is_empty() {
            panic_with_error!(&env, DisburseError::EmptyBatch);
        }
        if payments.len() > MAX_PAYMENTS {
            panic_with_error!(&env, DisburseError::BatchTooLarge);
        }
        let client = token::TokenClient::new(&env, &token);
        let mut total: i128 = 0;
        for p in payments.iter() {
            if p.amount <= 0 {
                panic_with_error!(&env, DisburseError::InvalidAmount);
            }
            client.transfer(&payer, &p.recipient, &p.amount);
            total += p.amount;
        }
        env.events().publish(
            (symbol_short!("disbursed"), payer, token),
            (reference, payments.len(), total),
        );
        total
    }

    /// Same as `disburse` with one amount for every recipient.
    pub fn disburse_equal(
        env: Env,
        payer: Address,
        token: Address,
        recipients: Vec<Address>,
        amount_each: i128,
        reference: String,
    ) -> i128 {
        let mut payments = Vec::new(&env);
        for r in recipients.iter() {
            payments.push_back(Payment {
                recipient: r,
                amount: amount_each,
            });
        }
        Self::disburse(env, payer, token, payments, reference)
    }

    pub fn max_payments(_env: Env) -> u32 {
        MAX_PAYMENTS
    }
}
