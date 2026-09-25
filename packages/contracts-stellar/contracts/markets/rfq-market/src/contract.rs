use ankara_common::roles::{self, require_role, Role};
use soroban_sdk::{
    contract, contractimpl, contracttype, panic_with_error, symbol_short, token, Address, BytesN,
    Env, Vec,
};

use crate::errors::RfqError;
use crate::types::{Intent, IntentStatus, Quote, QuoteStatus};

const DAY_IN_LEDGERS: u32 = 17280;
const BUMP_AMOUNT: u32 = 180 * DAY_IN_LEDGERS;
const LIFETIME_THRESHOLD: u32 = BUMP_AMOUNT - DAY_IN_LEDGERS;
const BPS: i128 = 10_000;
const MAX_FEE_BPS: u32 = 500;

#[contracttype]
#[derive(Clone)]
enum DataKey {
    FeeBps,
    FeeRecipient,
    NextIntentId,
    NextQuoteId,
    Intent(u64),
    Quote(u64),
    IntentQuotes(u64),
    TokenIntents(Address),
}

/// Request-for-quote / OTC secondary market for illiquid RWA tokens — the
/// liquidity model that fits a one-off farmland, invoice or building
/// token, which will never have AMM depth.
///
/// 1. **post_intent** — a holder escrows `amount` of any Ankara (or any
///    SEP-41) token and names the payment token, a floor price and an
///    expiry.
/// 2. **submit_quote** — counterparties post firm quotes; the quoted price
///    is escrowed with the quote, so it's always fundable.
/// 3. **accept_quote** — the seller picks one; the asset goes to the buyer
///    and the price (minus an optional protocol fee) to the seller in the
///    same transaction. Settlement is atomic.
/// 4. Losing quotes are refunded with **withdraw_quote**; unfilled intents
///    are refunded with **cancel_intent**.
///
/// Tokens gated by an identity verifier check both legs as normal; the
/// market contract's own address must be verified on such tokens to hold
/// the escrow.
#[contract]
pub struct RfqMarket;

#[contractimpl]
impl RfqMarket {
    pub fn initialize(env: Env, admin: Address, fee_bps: u32, fee_recipient: Address) {
        if roles::has_role(&env, Role::Manager) {
            panic_with_error!(&env, RfqError::AlreadyInitialized);
        }
        if fee_bps > MAX_FEE_BPS {
            panic_with_error!(&env, RfqError::InvalidFee);
        }
        roles::init_roles(&env, &admin);
        env.storage().instance().set(&DataKey::FeeBps, &fee_bps);
        env.storage().instance().set(&DataKey::FeeRecipient, &fee_recipient);
    }

    // ─── Seller ──────────────────────────────────────────────────────────

    pub fn post_intent(
        env: Env,
        seller: Address,
        asset_token: Address,
        amount: i128,
        quote_token: Address,
        min_total_price: i128,
        expires_at: u64,
    ) -> u64 {
        seller.require_auth();
        ankara_common::pausable::check_not_paused(&env);
        if amount <= 0 || min_total_price < 0 {
            panic_with_error!(&env, RfqError::InvalidAmount);
        }
        let now = env.ledger().timestamp();
        if expires_at <= now {
            panic_with_error!(&env, RfqError::InvalidExpiry);
        }
        let id = next(&env, DataKey::NextIntentId);
        let intent = Intent {
            id,
            seller: seller.clone(),
            asset_token: asset_token.clone(),
            amount,
            quote_token: quote_token.clone(),
            min_total_price,
            expires_at,
            status: IntentStatus::Open,
            created_at: now,
            accepted_quote: None,
        };
        write_intent(&env, &intent);
        push(&env, DataKey::TokenIntents(asset_token.clone()), id);
        token::TokenClient::new(&env, &asset_token).transfer(
            &seller,
            &env.current_contract_address(),
            &amount,
        );
        env.events().publish(
            (symbol_short!("intent"), asset_token, id),
            (seller, amount, quote_token, min_total_price, expires_at),
        );
        id
    }

    pub fn cancel_intent(env: Env, seller: Address, intent_id: u64) {
        seller.require_auth();
        let mut intent = read_intent(&env, intent_id);
        if intent.seller != seller {
            panic_with_error!(&env, RfqError::NotSeller);
        }
        if intent.status != IntentStatus::Open {
            panic_with_error!(&env, RfqError::IntentNotOpen);
        }
        intent.status = IntentStatus::Cancelled;
        write_intent(&env, &intent);
        token::TokenClient::new(&env, &intent.asset_token).transfer(
            &env.current_contract_address(),
            &seller,
            &intent.amount,
        );
        env.events()
            .publish((symbol_short!("int_cncl"), intent_id), seller);
    }

    /// Atomic settlement: asset to buyer, price (minus fee) to seller.
    pub fn accept_quote(env: Env, seller: Address, intent_id: u64, quote_id: u64) {
        seller.require_auth();
        ankara_common::pausable::check_not_paused(&env);
        let mut intent = read_intent(&env, intent_id);
        let mut quote = read_quote(&env, quote_id);
        if intent.seller != seller {
            panic_with_error!(&env, RfqError::NotSeller);
        }
        if intent.status != IntentStatus::Open {
            panic_with_error!(&env, RfqError::IntentNotOpen);
        }
        let now = env.ledger().timestamp();
        if now > intent.expires_at {
            panic_with_error!(&env, RfqError::IntentExpired);
        }
        if quote.intent_id != intent_id {
            panic_with_error!(&env, RfqError::QuoteIntentMismatch);
        }
        if quote.status != QuoteStatus::Active {
            panic_with_error!(&env, RfqError::QuoteNotActive);
        }
        if now > quote.expires_at {
            panic_with_error!(&env, RfqError::QuoteExpired);
        }

        intent.status = IntentStatus::Filled;
        intent.accepted_quote = Some(quote_id);
        quote.status = QuoteStatus::Accepted;
        write_intent(&env, &intent);
        write_quote(&env, &quote);

        let fee = quote.total_price * (fee_bps(&env) as i128) / BPS;
        let this = env.current_contract_address();
        let pay = token::TokenClient::new(&env, &intent.quote_token);
        pay.transfer(&this, &seller, &(quote.total_price - fee));
        if fee > 0 {
            pay.transfer(&this, &fee_recipient(&env), &fee);
        }
        token::TokenClient::new(&env, &intent.asset_token).transfer(
            &this,
            &quote.buyer,
            &intent.amount,
        );
        env.events().publish(
            (symbol_short!("settled"), intent.asset_token, intent_id),
            (quote_id, quote.buyer, intent.amount, quote.total_price, fee),
        );
    }

    // ─── Buyer ───────────────────────────────────────────────────────────

    /// Posts a firm quote for the whole intent; `total_price` of the
    /// intent's quote token is escrowed with it.
    pub fn submit_quote(
        env: Env,
        buyer: Address,
        intent_id: u64,
        total_price: i128,
        expires_at: u64,
    ) -> u64 {
        buyer.require_auth();
        ankara_common::pausable::check_not_paused(&env);
        let intent = read_intent(&env, intent_id);
        let now = env.ledger().timestamp();
        if intent.status != IntentStatus::Open {
            panic_with_error!(&env, RfqError::IntentNotOpen);
        }
        if now > intent.expires_at {
            panic_with_error!(&env, RfqError::IntentExpired);
        }
        if buyer == intent.seller {
            panic_with_error!(&env, RfqError::SelfQuote);
        }
        if total_price <= 0 {
            panic_with_error!(&env, RfqError::InvalidAmount);
        }
        if total_price < intent.min_total_price {
            panic_with_error!(&env, RfqError::BelowMinimum);
        }
        if expires_at <= now {
            panic_with_error!(&env, RfqError::InvalidExpiry);
        }
        let id = next(&env, DataKey::NextQuoteId);
        let quote = Quote {
            id,
            intent_id,
            buyer: buyer.clone(),
            total_price,
            expires_at,
            status: QuoteStatus::Active,
            created_at: now,
        };
        write_quote(&env, &quote);
        push(&env, DataKey::IntentQuotes(intent_id), id);
        token::TokenClient::new(&env, &intent.quote_token).transfer(
            &buyer,
            &env.current_contract_address(),
            &total_price,
        );
        env.events()
            .publish((symbol_short!("quote"), intent_id, id), (buyer, total_price, expires_at));
        id
    }

    /// Refunds an unaccepted quote (any time before acceptance — including
    /// after the intent was filled by someone else or cancelled).
    pub fn withdraw_quote(env: Env, buyer: Address, quote_id: u64) {
        buyer.require_auth();
        let mut quote = read_quote(&env, quote_id);
        if quote.buyer != buyer {
            panic_with_error!(&env, RfqError::NotBuyer);
        }
        if quote.status != QuoteStatus::Active {
            panic_with_error!(&env, RfqError::QuoteNotActive);
        }
        let intent = read_intent(&env, quote.intent_id);
        quote.status = QuoteStatus::Withdrawn;
        write_quote(&env, &quote);
        token::TokenClient::new(&env, &intent.quote_token).transfer(
            &env.current_contract_address(),
            &buyer,
            &quote.total_price,
        );
        env.events()
            .publish((symbol_short!("q_wdraw"), quote.intent_id, quote_id), buyer);
    }

    // ─── Admin (Role::Manager / Pauser) ──────────────────────────────────

    pub fn set_fee(env: Env, fee_bps: u32, fee_recipient: Address) {
        require_role(&env, Role::Manager);
        if fee_bps > MAX_FEE_BPS {
            panic_with_error!(&env, RfqError::InvalidFee);
        }
        env.storage().instance().set(&DataKey::FeeBps, &fee_bps);
        env.storage().instance().set(&DataKey::FeeRecipient, &fee_recipient);
        env.events().publish((symbol_short!("fee"),), (fee_bps, fee_recipient));
    }

    /// Pausing blocks new intents/quotes and settlement; cancellations and
    /// quote withdrawals stay open so escrowed funds are never stuck.
    pub fn pause(env: Env) {
        ankara_common::pausable::pause(&env);
    }

    pub fn unpause(env: Env) {
        ankara_common::pausable::unpause(&env);
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        require_role(&env, Role::Upgrader);
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    // ─── Reads ───────────────────────────────────────────────────────────

    pub fn get_intent(env: Env, intent_id: u64) -> Intent {
        read_intent(&env, intent_id)
    }

    pub fn get_quote(env: Env, quote_id: u64) -> Quote {
        read_quote(&env, quote_id)
    }

    pub fn quotes_for(env: Env, intent_id: u64) -> Vec<u64> {
        list(&env, DataKey::IntentQuotes(intent_id))
    }

    pub fn intents_for_token(env: Env, asset_token: Address) -> Vec<u64> {
        list(&env, DataKey::TokenIntents(asset_token))
    }

    pub fn fee_bps(env: Env) -> u32 {
        fee_bps(&env)
    }

    pub fn fee_recipient(env: Env) -> Address {
        fee_recipient(&env)
    }

    pub fn is_paused(env: Env) -> bool {
        ankara_common::pausable::is_paused(&env)
    }
}

fn next(env: &Env, key: DataKey) -> u64 {
    let id: u64 = env.storage().instance().get(&key).unwrap_or(0);
    env.storage().instance().set(&key, &(id + 1));
    id
}

fn fee_bps(env: &Env) -> u32 {
    env.storage().instance().get(&DataKey::FeeBps).unwrap_or(0)
}

fn fee_recipient(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::FeeRecipient).unwrap()
}

fn read_intent(env: &Env, id: u64) -> Intent {
    env.storage()
        .persistent()
        .get(&DataKey::Intent(id))
        .unwrap_or_else(|| panic_with_error!(env, RfqError::IntentNotFound))
}

fn write_intent(env: &Env, i: &Intent) {
    let key = DataKey::Intent(i.id);
    env.storage().persistent().set(&key, i);
    env.storage()
        .persistent()
        .extend_ttl(&key, LIFETIME_THRESHOLD, BUMP_AMOUNT);
}

fn read_quote(env: &Env, id: u64) -> Quote {
    env.storage()
        .persistent()
        .get(&DataKey::Quote(id))
        .unwrap_or_else(|| panic_with_error!(env, RfqError::QuoteNotFound))
}

fn write_quote(env: &Env, q: &Quote) {
    let key = DataKey::Quote(q.id);
    env.storage().persistent().set(&key, q);
    env.storage()
        .persistent()
        .extend_ttl(&key, LIFETIME_THRESHOLD, BUMP_AMOUNT);
}

fn list(env: &Env, key: DataKey) -> Vec<u64> {
    env.storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| Vec::new(env))
}

fn push(env: &Env, key: DataKey, id: u64) {
    let mut ids = list(env, key.clone());
    ids.push_back(id);
    env.storage().persistent().set(&key, &ids);
    env.storage()
        .persistent()
        .extend_ttl(&key, LIFETIME_THRESHOLD, BUMP_AMOUNT);
}

