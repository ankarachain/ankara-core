use soroban_sdk::{contracttype, Address, Vec};

#[contracttype]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum CircleMode {
    /// ROSCA / esusu / ajo / chama: every member contributes each round
    /// and the whole pot goes to one member per round, in join order.
    Rotating,
    /// Savings-and-credit group (VSLA-style): members save each period,
    /// may borrow from the pool against their savings, and at the end
    /// everyone withdraws savings plus a pro-rata share of loan fees.
    Pooled,
}

#[contracttype]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum CircleStatus {
    /// Accepting members.
    Forming,
    Active,
    Completed,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Circle {
    pub id: u64,
    pub organizer: Address,
    pub token: Address,
    pub mode: CircleMode,
    pub contribution: i128,
    pub period_secs: u64,
    pub max_members: u32,
    /// Pooled mode: number of saving periods before the circle ends.
    /// Rotating mode: always equals `max_members`.
    pub rounds: u32,
    pub members: Vec<Address>,
    pub status: CircleStatus,
    pub started_at: u64,
    /// Rotating: index of the round currently collecting.
    pub current_round: u32,
    /// Rotating: collected for the current round.
    pub pot: i128,
    /// Pooled: max borrowing as a multiple of own savings, in bps
    /// (e.g. 20_000 = 2x savings).
    pub borrow_multiple_bps: u32,
    /// Pooled: flat fee on each loan, paid into the pool.
    pub loan_fee_bps: u32,
    /// Pooled: cash in the pool (savings + fees - lent out).
    pub pool_cash: i128,
    pub total_savings: i128,
    pub total_fees: i128,
    /// Pooled close-out: frozen at the first withdrawal after the end.
    pub closed: bool,
    pub close_pool: i128,
    pub close_weight: i128,
}

/// Pooled mode: a member's outstanding loan. `principal == 0` = none.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MemberLoan {
    pub principal: i128,
    pub fee: i128,
    pub taken_at: u64,
}

impl MemberLoan {
    pub fn none() -> Self {
        MemberLoan { principal: 0, fee: 0, taken_at: 0 }
    }

    pub fn is_some(&self) -> bool {
        self.principal > 0
    }
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MemberState {
    /// Pooled: total saved. Rotating: total contributed.
    pub saved: i128,
    /// Rotating: rounds missed when a round was disbursed without them.
    pub missed: u32,
    /// Rotating: has received its payout.
    pub paid_out: bool,
    /// Pooled: outstanding loan (`principal == 0` when none).
    pub loan: MemberLoan,
    pub withdrawn: bool,
    /// Last round/period this member contributed in (+1; 0 = never).
    pub last_contributed: u32,
}
