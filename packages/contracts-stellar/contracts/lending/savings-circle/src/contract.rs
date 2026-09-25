use soroban_sdk::{
    contract, contractimpl, contracttype, panic_with_error, symbol_short, token, Address, Env, Vec,
};

use crate::errors::CircleError;
use crate::types::{Circle, CircleMode, CircleStatus, MemberLoan, MemberState};

const DAY_IN_LEDGERS: u32 = 17280;
const BUMP_AMOUNT: u32 = 365 * DAY_IN_LEDGERS;
const LIFETIME_THRESHOLD: u32 = BUMP_AMOUNT - 30 * DAY_IN_LEDGERS;
const BPS: i128 = 10_000;
const MAX_MEMBERS: u32 = 50;
const MAX_BORROW_MULTIPLE_BPS: u32 = 50_000;

#[contracttype]
enum DataKey {
    NextId,
    Circle(u64),
    Member(u64, Address),
}

/// On-chain group savings and lending — the informal finance pattern (ajo,
/// esusu, chama, tontine, susu, VSLA) that has no collateral requirement
/// because the group itself is the guarantee.
///
/// **Rotating** — `n` members each contribute `contribution` per round;
/// each round's pot goes to one member, in join order, for `n` rounds.
/// `disburse` pays out as soon as everyone has contributed, or after the
/// round's deadline with whatever was collected (missed contributions are
/// recorded on the member, visible to the group).
///
/// **Pooled** — members save `contribution` per period for `rounds`
/// periods. Any member may borrow from the pool up to
/// `borrow_multiple_bps` of their own savings (so a member can draw more
/// than they put in, backed by the group), repaying principal plus a flat
/// fee that accrues to the pool. After the last period everyone withdraws
/// savings plus a pro-rata share of fees; members still owing at the end
/// forfeit their savings to the pool, so losses are absorbed by the
/// defaulter first and socialized only beyond that.
///
/// Singleton — any number of circles, any SEP-41 token. No admin; each
/// circle's rules are fixed by its organizer at creation.
#[contract]
pub struct SavingsCircle;

#[contractimpl]
impl SavingsCircle {
    /// The organizer creates the circle and is its first member. Rotating
    /// circles ignore `rounds`, `borrow_multiple_bps` and `loan_fee_bps`.
    #[allow(clippy::too_many_arguments)]
    pub fn create_circle(
        env: Env,
        organizer: Address,
        token: Address,
        mode: CircleMode,
        contribution: i128,
        period_secs: u64,
        max_members: u32,
        rounds: u32,
        borrow_multiple_bps: u32,
        loan_fee_bps: u32,
    ) -> u64 {
        organizer.require_auth();
        if contribution <= 0
            || period_secs == 0
            || max_members < 2
            || max_members > MAX_MEMBERS
            || (mode == CircleMode::Pooled
                && (rounds == 0 || borrow_multiple_bps > MAX_BORROW_MULTIPLE_BPS || loan_fee_bps > 5_000))
        {
            panic_with_error!(&env, CircleError::InvalidConfig);
        }
        let id: u64 = env.storage().instance().get(&DataKey::NextId).unwrap_or(0);
        env.storage().instance().set(&DataKey::NextId, &(id + 1));
        let mut members = Vec::new(&env);
        members.push_back(organizer.clone());
        let circle = Circle {
            id,
            organizer: organizer.clone(),
            token,
            mode,
            contribution,
            period_secs,
            max_members,
            rounds: if mode == CircleMode::Rotating { max_members } else { rounds },
            members,
            status: CircleStatus::Forming,
            started_at: 0,
            current_round: 0,
            pot: 0,
            borrow_multiple_bps: if mode == CircleMode::Pooled { borrow_multiple_bps } else { 0 },
            loan_fee_bps: if mode == CircleMode::Pooled { loan_fee_bps } else { 0 },
            pool_cash: 0,
            total_savings: 0,
            total_fees: 0,
            closed: false,
            close_pool: 0,
            close_weight: 0,
        };
        write_member(&env, id, &organizer, &new_member());
        write(&env, &circle);
        env.events()
            .publish((symbol_short!("circle"), id), (organizer, mode, contribution));
        id
    }

    /// Joins a forming circle. The circle starts automatically when full.
    pub fn join(env: Env, member: Address, circle_id: u64) {
        member.require_auth();
        let mut c = read(&env, circle_id);
        if c.status != CircleStatus::Forming {
            panic_with_error!(&env, CircleError::NotForming);
        }
        if c.members.contains(&member) {
            panic_with_error!(&env, CircleError::AlreadyMember);
        }
        if c.members.len() >= c.max_members {
            panic_with_error!(&env, CircleError::CircleFull);
        }
        c.members.push_back(member.clone());
        write_member(&env, circle_id, &member, &new_member());
        if c.members.len() == c.max_members {
            start(&env, &mut c);
        }
        write(&env, &c);
        env.events().publish((symbol_short!("joined"), circle_id), member);
    }

    /// Starts a forming circle early with the members it has (≥ 2).
    /// Rotating circles then run one round per member.
    pub fn start_circle(env: Env, organizer: Address, circle_id: u64) {
        organizer.require_auth();
        let mut c = read(&env, circle_id);
        if c.organizer != organizer {
            panic_with_error!(&env, CircleError::NotOrganizer);
        }
        if c.status != CircleStatus::Forming {
            panic_with_error!(&env, CircleError::NotForming);
        }
        if c.members.len() < 2 {
            panic_with_error!(&env, CircleError::InvalidConfig);
        }
        if c.mode == CircleMode::Rotating {
            c.rounds = c.members.len();
        }
        start(&env, &mut c);
        write(&env, &c);
    }

    /// Pays this member's contribution for the current round (rotating) or
    /// period (pooled). One contribution per member per round/period.
    pub fn contribute(env: Env, member: Address, circle_id: u64) {
        member.require_auth();
        let mut c = read(&env, circle_id);
        if c.status != CircleStatus::Active {
            panic_with_error!(&env, CircleError::NotActive);
        }
        let mut m = read_member(&env, circle_id, &member);
        let round = match c.mode {
            CircleMode::Rotating => c.current_round,
            CircleMode::Pooled => {
                let p = period_index(&env, &c);
                if p >= c.rounds {
                    panic_with_error!(&env, CircleError::Ended);
                }
                p
            }
        };
        if m.last_contributed == round + 1 {
            panic_with_error!(&env, CircleError::AlreadyContributed);
        }
        m.last_contributed = round + 1;
        m.saved += c.contribution;
        match c.mode {
            CircleMode::Rotating => c.pot += c.contribution,
            CircleMode::Pooled => {
                c.pool_cash += c.contribution;
                c.total_savings += c.contribution;
            }
        }
        write_member(&env, circle_id, &member, &m);
        write(&env, &c);
        token::TokenClient::new(&env, &c.token).transfer(
            &member,
            &env.current_contract_address(),
            &c.contribution,
        );
        env.events()
            .publish((symbol_short!("contrib"), circle_id, member), (round, c.contribution));
    }

    /// Rotating mode: pays the current round's pot to its recipient. Anyone
    /// can call once every member has contributed, or once the round's
    /// deadline has passed. Returns the amount paid.
    pub fn disburse(env: Env, circle_id: u64) -> i128 {
        let mut c = read(&env, circle_id);
        if c.mode != CircleMode::Rotating {
            panic_with_error!(&env, CircleError::WrongMode);
        }
        if c.status != CircleStatus::Active {
            panic_with_error!(&env, CircleError::NotActive);
        }
        let round = c.current_round;
        let deadline = c.started_at + (round as u64 + 1) * c.period_secs;
        let mut all_in = true;
        for addr in c.members.iter() {
            if read_member(&env, circle_id, &addr).last_contributed != round + 1 {
                all_in = false;
            }
        }
        if !all_in && env.ledger().timestamp() < deadline {
            panic_with_error!(&env, CircleError::RoundNotReady);
        }
        if !all_in {
            for addr in c.members.iter() {
                let mut m = read_member(&env, circle_id, &addr);
                if m.last_contributed != round + 1 {
                    m.missed += 1;
                    write_member(&env, circle_id, &addr, &m);
                }
            }
        }
        let recipient = c.members.get(round).unwrap();
        let amount = c.pot;
        let mut rm = read_member(&env, circle_id, &recipient);
        rm.paid_out = true;
        write_member(&env, circle_id, &recipient, &rm);

        c.pot = 0;
        c.current_round += 1;
        if c.current_round >= c.rounds {
            c.status = CircleStatus::Completed;
        }
        write(&env, &c);
        if amount > 0 {
            token::TokenClient::new(&env, &c.token).transfer(
                &env.current_contract_address(),
                &recipient,
                &amount,
            );
        }
        env.events()
            .publish((symbol_short!("disbursed"), circle_id, recipient), (round, amount));
        amount
    }

    /// Pooled mode: borrow from the pool, up to `borrow_multiple_bps` of
    /// own savings. One outstanding loan per member; not after the end.
    pub fn borrow(env: Env, member: Address, circle_id: u64, amount: i128) {
        member.require_auth();
        let mut c = read(&env, circle_id);
        require_pooled_active(&env, &c);
        if period_index(&env, &c) >= c.rounds {
            panic_with_error!(&env, CircleError::Ended);
        }
        let mut m = read_member(&env, circle_id, &member);
        if m.loan.is_some() {
            panic_with_error!(&env, CircleError::LoanOutstanding);
        }
        if amount <= 0 || amount > m.saved * (c.borrow_multiple_bps as i128) / BPS {
            panic_with_error!(&env, CircleError::ExceedsBorrowLimit);
        }
        if amount > c.pool_cash {
            panic_with_error!(&env, CircleError::InsufficientPool);
        }
        let fee = amount * (c.loan_fee_bps as i128) / BPS;
        m.loan = MemberLoan {
            principal: amount,
            fee,
            taken_at: env.ledger().timestamp(),
        };
        c.pool_cash -= amount;
        write_member(&env, circle_id, &member, &m);
        write(&env, &c);
        token::TokenClient::new(&env, &c.token).transfer(
            &env.current_contract_address(),
            &member,
            &amount,
        );
        env.events()
            .publish((symbol_short!("borrowed"), circle_id, member), (amount, fee));
    }

    /// Pooled mode: repays principal + fee in full. Allowed until close-out.
    pub fn repay(env: Env, member: Address, circle_id: u64) -> i128 {
        member.require_auth();
        let mut c = read(&env, circle_id);
        require_pooled_active(&env, &c);
        if c.closed {
            panic_with_error!(&env, CircleError::Ended);
        }
        let mut m = read_member(&env, circle_id, &member);
        if !m.loan.is_some() {
            panic_with_error!(&env, CircleError::NoLoan);
        }
        let loan = m.loan.clone();
        let due = loan.principal + loan.fee;
        m.loan = MemberLoan::none();
        c.pool_cash += due;
        c.total_fees += loan.fee;
        write_member(&env, circle_id, &member, &m);
        write(&env, &c);
        token::TokenClient::new(&env, &c.token).transfer(
            &member,
            &env.current_contract_address(),
            &due,
        );
        env.events()
            .publish((symbol_short!("repaid"), circle_id, member), due);
        due
    }

    /// Pooled mode, after the last period: pays out the member's share of
    /// the pool (pro-rata to savings). The first withdrawal freezes the
    /// pool; members with an unpaid loan at that point forfeit their share.
    pub fn withdraw(env: Env, member: Address, circle_id: u64) -> i128 {
        member.require_auth();
        let mut c = read(&env, circle_id);
        require_pooled_active(&env, &c);
        if period_index(&env, &c) < c.rounds {
            panic_with_error!(&env, CircleError::NotEnded);
        }
        if !c.closed {
            let mut weight: i128 = 0;
            for addr in c.members.iter() {
                let m = read_member(&env, circle_id, &addr);
                if !m.loan.is_some() {
                    weight += m.saved;
                }
            }
            c.closed = true;
            c.close_pool = c.pool_cash;
            c.close_weight = weight;
        }
        let mut m = read_member(&env, circle_id, &member);
        if m.withdrawn {
            panic_with_error!(&env, CircleError::AlreadyWithdrawn);
        }
        if m.loan.is_some() {
            panic_with_error!(&env, CircleError::LoanOutstanding);
        }
        let share = if c.close_weight > 0 {
            c.close_pool * m.saved / c.close_weight
        } else {
            0
        };
        m.withdrawn = true;
        c.pool_cash -= share;
        write_member(&env, circle_id, &member, &m);
        write(&env, &c);
        if share > 0 {
            token::TokenClient::new(&env, &c.token).transfer(
                &env.current_contract_address(),
                &member,
                &share,
            );
        }
        env.events()
            .publish((symbol_short!("withdrawn"), circle_id, member), share);
        share
    }

    // ─── Reads ───────────────────────────────────────────────────────────

    pub fn get_circle(env: Env, circle_id: u64) -> Circle {
        read(&env, circle_id)
    }

    pub fn get_member(env: Env, circle_id: u64, member: Address) -> MemberState {
        read_member(&env, circle_id, &member)
    }

    /// Rotating: who receives the current round's pot.
    pub fn current_recipient(env: Env, circle_id: u64) -> Option<Address> {
        let c = read(&env, circle_id);
        if c.mode != CircleMode::Rotating || c.status != CircleStatus::Active {
            return None;
        }
        c.members.get(c.current_round)
    }

    /// Pooled: how much `member` could borrow right now.
    pub fn borrow_limit(env: Env, circle_id: u64, member: Address) -> i128 {
        let c = read(&env, circle_id);
        if c.mode != CircleMode::Pooled || c.status != CircleStatus::Active {
            return 0;
        }
        let m = read_member(&env, circle_id, &member);
        if m.loan.is_some() {
            return 0;
        }
        (m.saved * (c.borrow_multiple_bps as i128) / BPS).min(c.pool_cash)
    }

    /// Pooled: 0-based index of the current saving period.
    pub fn current_period(env: Env, circle_id: u64) -> u32 {
        period_index(&env, &read(&env, circle_id))
    }

    pub fn circle_count(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::NextId).unwrap_or(0)
    }
}

fn new_member() -> MemberState {
    MemberState {
        saved: 0,
        missed: 0,
        paid_out: false,
        loan: MemberLoan::none(),
        withdrawn: false,
        last_contributed: 0,
    }
}

fn start(env: &Env, c: &mut Circle) {
    c.status = CircleStatus::Active;
    c.started_at = env.ledger().timestamp();
    env.events()
        .publish((symbol_short!("started"), c.id), c.members.len());
}

fn period_index(env: &Env, c: &Circle) -> u32 {
    if c.status == CircleStatus::Forming {
        return 0;
    }
    let elapsed = env.ledger().timestamp().saturating_sub(c.started_at);
    let p = elapsed / c.period_secs;
    if p > u32::MAX as u64 {
        u32::MAX
    } else {
        p as u32
    }
}

fn require_pooled_active(env: &Env, c: &Circle) {
    if c.mode != CircleMode::Pooled {
        panic_with_error!(env, CircleError::WrongMode);
    }
    if c.status != CircleStatus::Active {
        panic_with_error!(env, CircleError::NotActive);
    }
}

fn read(env: &Env, id: u64) -> Circle {
    env.storage()
        .persistent()
        .get(&DataKey::Circle(id))
        .unwrap_or_else(|| panic_with_error!(env, CircleError::CircleNotFound))
}

fn write(env: &Env, c: &Circle) {
    let key = DataKey::Circle(c.id);
    env.storage().persistent().set(&key, c);
    env.storage()
        .persistent()
        .extend_ttl(&key, LIFETIME_THRESHOLD, BUMP_AMOUNT);
}

fn read_member(env: &Env, id: u64, member: &Address) -> MemberState {
    env.storage()
        .persistent()
        .get(&DataKey::Member(id, member.clone()))
        .unwrap_or_else(|| panic_with_error!(env, CircleError::NotMember))
}

fn write_member(env: &Env, id: u64, member: &Address, m: &MemberState) {
    let key = DataKey::Member(id, member.clone());
    env.storage().persistent().set(&key, m);
    env.storage()
        .persistent()
        .extend_ttl(&key, LIFETIME_THRESHOLD, BUMP_AMOUNT);
}
