use soroban_sdk::{contract, contractimpl, panic_with_error, symbol_short, token, Address, Env, Vec};

use crate::errors::StreamError;
use crate::stream::{self, Schedule, Stream, Tranche};

const MAX_TRANCHES: u32 = 48;

/// Payment streaming / vesting. A sender locks a token balance for a
/// recipient, released either continuously per second (salary-style
/// streams, optional cliff) or in discrete tranches (installments, vesting
/// schedules). The recipient can query and withdraw what's claimable at any
/// time.
///
/// Singleton — one deployment serves any number of streams, in any SEP-41
/// token (USDC SAC, an Ankara template token, ...). There's no admin: each
/// stream is controlled only by its own sender and recipient.
///
/// Cancellation (only for streams created `cancelable`): vested-but-unclaimed
/// funds go to the recipient, the unvested remainder back to the sender.
#[contract]
pub struct PaymentStream;

#[contractimpl]
impl PaymentStream {
    /// Linear stream from `start` to `end` (unix seconds), nothing claimable
    /// before `cliff` (pass `cliff = start` for no cliff). Pulls
    /// `total_amount` of `token` from `sender` into the contract.
    #[allow(clippy::too_many_arguments)]
    pub fn create_stream(
        env: Env,
        sender: Address,
        recipient: Address,
        token: Address,
        total_amount: i128,
        start: u64,
        cliff: u64,
        end: u64,
        cancelable: bool,
    ) -> u64 {
        sender.require_auth();
        if total_amount <= 0 {
            panic_with_error!(&env, StreamError::InvalidAmount);
        }
        if start >= end || cliff < start || cliff > end {
            panic_with_error!(&env, StreamError::InvalidSchedule);
        }
        create(
            &env,
            sender,
            recipient,
            token,
            total_amount,
            Schedule::Linear(start, cliff, end),
            cancelable,
        )
    }

    /// Step schedule: each tranche's `amount` unlocks at its `unlock_time`.
    /// Tranches must be strictly increasing in time, each amount > 0; the
    /// total locked is their sum. Max 48 tranches.
    pub fn create_schedule(
        env: Env,
        sender: Address,
        recipient: Address,
        token: Address,
        tranches: Vec<Tranche>,
        cancelable: bool,
    ) -> u64 {
        sender.require_auth();
        if tranches.is_empty() {
            panic_with_error!(&env, StreamError::InvalidSchedule);
        }
        if tranches.len() > MAX_TRANCHES {
            panic_with_error!(&env, StreamError::TooManyTranches);
        }
        let mut total: i128 = 0;
        let mut last: Option<u64> = None;
        for t in tranches.iter() {
            if t.amount <= 0 {
                panic_with_error!(&env, StreamError::InvalidAmount);
            }
            if let Some(prev) = last {
                if t.unlock_time <= prev {
                    panic_with_error!(&env, StreamError::InvalidSchedule);
                }
            }
            last = Some(t.unlock_time);
            total += t.amount;
        }
        create(
            &env,
            sender,
            recipient,
            token,
            total,
            Schedule::Tranches(tranches),
            cancelable,
        )
    }

    /// Withdraws `amount` (or everything claimable, if `None`) to the
    /// recipient. Returns the amount paid out.
    pub fn withdraw(env: Env, recipient: Address, stream_id: u64, amount: Option<i128>) -> i128 {
        recipient.require_auth();
        let mut s = stream::get(&env, stream_id);
        if s.recipient != recipient {
            panic_with_error!(&env, StreamError::NotRecipient);
        }
        let claimable = s.claimable(env.ledger().timestamp());
        let pay = amount.unwrap_or(claimable);
        if pay <= 0 {
            panic_with_error!(&env, StreamError::InvalidAmount);
        }
        if pay > claimable {
            panic_with_error!(&env, StreamError::ExceedsClaimable);
        }
        s.withdrawn += pay;
        stream::set(&env, &s);
        token::TokenClient::new(&env, &s.token).transfer(
            &env.current_contract_address(),
            &recipient,
            &pay,
        );
        env.events()
            .publish((symbol_short!("withdrawn"), stream_id), (recipient, pay));
        pay
    }

    /// Cancels a cancelable stream. Returns `(paid_to_recipient,
    /// refunded_to_sender)`.
    pub fn cancel(env: Env, sender: Address, stream_id: u64) -> (i128, i128) {
        sender.require_auth();
        let mut s = stream::get(&env, stream_id);
        if s.sender != sender {
            panic_with_error!(&env, StreamError::NotSender);
        }
        if !s.cancelable {
            panic_with_error!(&env, StreamError::NotCancelable);
        }
        if s.is_closed() {
            panic_with_error!(&env, StreamError::StreamClosed);
        }
        let now = env.ledger().timestamp();
        let owed = s.claimable(now);
        let refund = s.total_amount - s.vested(now);
        // Vesting is frozen at `cancelled_at`, so after this the stream's
        // claimable balance is exactly zero.
        s.cancelled_at = now.max(1);
        s.withdrawn += owed;
        s.refunded = refund;
        stream::set(&env, &s);

        let client = token::TokenClient::new(&env, &s.token);
        if owed > 0 {
            client.transfer(&env.current_contract_address(), &s.recipient, &owed);
        }
        if refund > 0 {
            client.transfer(&env.current_contract_address(), &sender, &refund);
        }
        env.events()
            .publish((symbol_short!("cancelled"), stream_id), (owed, refund));
        (owed, refund)
    }

    // ─── Reads ───────────────────────────────────────────────────────────

    pub fn get_stream(env: Env, stream_id: u64) -> Stream {
        stream::get(&env, stream_id)
    }

    /// What the recipient could withdraw right now.
    pub fn claimable(env: Env, stream_id: u64) -> i128 {
        stream::get(&env, stream_id).claimable(env.ledger().timestamp())
    }

    /// Vested so far (withdrawn + claimable).
    pub fn vested(env: Env, stream_id: u64) -> i128 {
        stream::get(&env, stream_id).vested(env.ledger().timestamp())
    }

    pub fn streams_by_sender(env: Env, sender: Address) -> Vec<u64> {
        stream::by_sender(&env, &sender)
    }

    pub fn streams_by_recipient(env: Env, recipient: Address) -> Vec<u64> {
        stream::by_recipient(&env, &recipient)
    }

    pub fn stream_count(env: Env) -> u64 {
        stream::count(&env)
    }
}

fn create(
    env: &Env,
    sender: Address,
    recipient: Address,
    token_addr: Address,
    total_amount: i128,
    schedule: Schedule,
    cancelable: bool,
) -> u64 {
    let id = stream::next_id(env);
    let s = Stream {
        id,
        sender: sender.clone(),
        recipient: recipient.clone(),
        token: token_addr.clone(),
        total_amount,
        withdrawn: 0,
        schedule,
        cancelable,
        cancelled_at: 0,
        refunded: 0,
        created_at: env.ledger().timestamp(),
    };
    stream::set(env, &s);
    stream::index(env, &s);
    token::TokenClient::new(env, &token_addr).transfer(
        &sender,
        &env.current_contract_address(),
        &total_amount,
    );
    env.events().publish(
        (symbol_short!("created"), id),
        (sender, recipient, token_addr, total_amount),
    );
    id
}
