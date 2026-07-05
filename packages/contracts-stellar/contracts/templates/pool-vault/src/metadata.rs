use soroban_sdk::{contracttype, vec, Address, Env, Vec};

pub const MAX_TOKENS_PER_VAULT: u32 = 50;
pub const YEAR_IN_SECONDS: u64 = 365 * 24 * 60 * 60;
pub const PRICE_SCALE: i128 = 1_000_000_000_000_000_000; // 1e18 = $1.00, matching the EVM oracle's fixed-point convention

#[contracttype]
enum DataKey {
    AcceptedTokens,
    IsAccepted(Address),
    TokenWeightBps(Address),
    MinDeposit(Address),
    Oracle,
    ManagementFeeBps,
    LastFeeAccrual,
}

pub fn init_vault(env: &Env, oracle: Option<Address>, management_fee_bps: u32) {
    env.storage()
        .instance()
        .set(&DataKey::AcceptedTokens, &Vec::<Address>::new(env));
    if let Some(o) = oracle {
        env.storage().instance().set(&DataKey::Oracle, &o);
    }
    let fee = if management_fee_bps > 0 {
        management_fee_bps
    } else {
        50
    };
    env.storage().instance().set(&DataKey::ManagementFeeBps, &fee);
    env.storage()
        .instance()
        .set(&DataKey::LastFeeAccrual, &env.ledger().timestamp());
}

pub fn accepted_tokens(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&DataKey::AcceptedTokens)
        .unwrap_or_else(|| vec![env])
}

pub fn is_accepted(env: &Env, token: &Address) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::IsAccepted(token.clone()))
        .unwrap_or(false)
}

pub fn add_accepted_token(env: &Env, token: Address, weight_bps: u32) {
    env.storage()
        .instance()
        .set(&DataKey::IsAccepted(token.clone()), &true);
    env.storage()
        .instance()
        .set(&DataKey::TokenWeightBps(token.clone()), &weight_bps);
    let mut tokens = accepted_tokens(env);
    tokens.push_back(token);
    env.storage().instance().set(&DataKey::AcceptedTokens, &tokens);
}

pub fn remove_accepted_token(env: &Env, token: &Address) {
    env.storage()
        .instance()
        .set(&DataKey::IsAccepted(token.clone()), &false);
    env.storage()
        .instance()
        .set(&DataKey::TokenWeightBps(token.clone()), &0u32);
    let tokens = accepted_tokens(env);
    let mut updated: Vec<Address> = vec![env];
    for t in tokens.iter() {
        if t != *token {
            updated.push_back(t);
        }
    }
    env.storage()
        .instance()
        .set(&DataKey::AcceptedTokens, &updated);
}

pub fn token_weight(env: &Env, token: &Address) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::TokenWeightBps(token.clone()))
        .unwrap_or(0)
}

pub fn min_deposit(env: &Env, token: &Address) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::MinDeposit(token.clone()))
        .unwrap_or(0)
}

pub fn set_min_deposit(env: &Env, token: Address, min_amount: i128) {
    env.storage()
        .instance()
        .set(&DataKey::MinDeposit(token), &min_amount);
}

pub fn oracle(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::Oracle)
}

pub fn set_oracle(env: &Env, oracle: Address) {
    env.storage().instance().set(&DataKey::Oracle, &oracle);
}

pub fn management_fee_bps(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::ManagementFeeBps)
        .unwrap_or(0)
}

pub fn set_management_fee_bps(env: &Env, new_fee: u32) {
    env.storage().instance().set(&DataKey::ManagementFeeBps, &new_fee);
}

pub fn last_fee_accrual(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::LastFeeAccrual)
        .unwrap_or(0)
}

pub fn set_last_fee_accrual(env: &Env, timestamp: u64) {
    env.storage().instance().set(&DataKey::LastFeeAccrual, &timestamp);
}
