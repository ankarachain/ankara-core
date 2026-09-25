#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, BytesN, Env, String,
};

use farmland_token::{FarmlandMetadata, FarmlandToken, FarmlandTokenClient};
use manual_oracle::{ManualOracle, ManualOracleClient};

use crate::contract::{PoolVault, PoolVaultClient};

fn deploy_asset_token<'a>(env: &'a Env, admin: &Address) -> FarmlandTokenClient<'a> {
    let contract_id = env.register(FarmlandToken, ());
    let client = FarmlandTokenClient::new(env, &contract_id);
    client.initialize(
        &String::from_str(env, "Farmland Share"),
        &String::from_str(env, "FLS"),
        &BytesN::from_array(env, &[1u8; 32]),
        &String::from_str(env, "NG"),
        admin,
        &None,
        &None,
        &FarmlandMetadata {
            location: String::from_str(env, "6.5,3.3"),
            area_sq_meters: 1_000,
            soil_type: String::from_str(env, "loam"),
            irrigation_type: String::from_str(env, "rain-fed"),
            crop_history: String::from_str(env, "maize"),
            title_document_hash: BytesN::from_array(env, &[2u8; 32]),
            valuation_usd: 1_000,
            state_region: String::from_str(env, "Kaduna"),
            last_updated: 0,
        },
    );
    client
}

fn deploy_oracle<'a>(env: &'a Env, admin: &Address) -> ManualOracleClient<'a> {
    let contract_id = env.register(ManualOracle, ());
    let client = ManualOracleClient::new(env, &contract_id);
    client.initialize(admin, &86_400);
    client
}

fn setup(env: &Env) -> (Address, PoolVaultClient<'_>) {
    let admin = Address::generate(env);
    let contract_id = env.register(PoolVault, ());
    let client = PoolVaultClient::new(env, &contract_id);
    client.initialize(
        &String::from_str(env, "Ankara Commodity Basket"),
        &String::from_str(env, "ACB"),
        &BytesN::from_array(env, &[3u8; 32]),
        &String::from_str(env, "NG"),
        &admin,
        &None,
        &None,
        &None,
        &0,
    );
    (admin, client)
}

#[test]
fn add_accepted_token_and_set_oracle() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    env.ledger().with_mut(|l| l.timestamp = 1_700_000_000);
    let (admin, vault) = setup(&env);
    let asset_token = deploy_asset_token(&env, &admin);
    let oracle = deploy_oracle(&env, &admin);

    vault.add_accepted_token(&asset_token.address, &5_000);
    vault.set_oracle(&oracle.address);

    assert!(vault.is_accepted(&asset_token.address));
    assert_eq!(vault.management_fee_bps(), 50); // defaults to 50 bps when 0 passed at init
}

#[test]
fn deposit_bootstraps_nav_at_one_dollar() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    env.ledger().with_mut(|l| l.timestamp = 1_700_000_000);
    let (admin, vault) = setup(&env);
    let asset_token = deploy_asset_token(&env, &admin);
    let oracle = deploy_oracle(&env, &admin);

    vault.add_accepted_token(&asset_token.address, &10_000);
    vault.set_oracle(&oracle.address);
    oracle.set_price(&asset_token.address, &1_000_000_000_000_000_000_i128); // $1.00

    let investor = Address::generate(&env);
    asset_token.mint(&investor, &1_000);

    vault.deposit(&investor, &asset_token.address, &500);

    // Bootstrap: 500 units @ $1.00 = $500 -> 500 pool tokens minted 1:1
    assert_eq!(vault.balance(&investor), 500);
    assert_eq!(asset_token.balance(&investor), 500);
    assert_eq!(asset_token.balance(&vault.address), 500);
}

#[test]
fn withdraw_returns_proportional_basket() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    env.ledger().with_mut(|l| l.timestamp = 1_700_000_000);
    let (admin, vault) = setup(&env);
    let asset_token = deploy_asset_token(&env, &admin);
    let oracle = deploy_oracle(&env, &admin);

    vault.add_accepted_token(&asset_token.address, &10_000);
    vault.set_oracle(&oracle.address);
    oracle.set_price(&asset_token.address, &1_000_000_000_000_000_000_i128);

    let investor = Address::generate(&env);
    asset_token.mint(&investor, &1_000);
    vault.deposit(&investor, &asset_token.address, &500);

    vault.withdraw(&investor, &500);

    assert_eq!(vault.balance(&investor), 0);
    assert_eq!(asset_token.balance(&investor), 1_000);
}

#[test]
#[should_panic]
fn deposit_rejects_non_accepted_token() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    env.ledger().with_mut(|l| l.timestamp = 1_700_000_000);
    let (admin, vault) = setup(&env);
    let asset_token = deploy_asset_token(&env, &admin);

    let investor = Address::generate(&env);
    asset_token.mint(&investor, &1_000);
    vault.deposit(&investor, &asset_token.address, &500);
}

#[test]
fn accrue_management_fee_mints_to_fee_recipient() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    env.ledger().with_mut(|l| l.timestamp = 1_700_000_000);

    let admin = Address::generate(&env);
    let fee_recipient = Address::generate(&env);
    let contract_id = env.register(PoolVault, ());
    let vault = PoolVaultClient::new(&env, &contract_id);
    vault.initialize(
        &String::from_str(&env, "Ankara Commodity Basket"),
        &String::from_str(&env, "ACB"),
        &BytesN::from_array(&env, &[3u8; 32]),
        &String::from_str(&env, "NG"),
        &admin,
        &None,
        &Some(fee_recipient.clone()),
        &None,
        &1_000, // 10% annual fee, to make the effect observable quickly
    );

    let asset_token = deploy_asset_token(&env, &admin);
    let oracle = deploy_oracle(&env, &admin);
    vault.add_accepted_token(&asset_token.address, &10_000);
    vault.set_oracle(&oracle.address);
    oracle.set_price(&asset_token.address, &1_000_000_000_000_000_000_i128);

    let investor = Address::generate(&env);
    asset_token.mint(&investor, &1_000_000);
    vault.deposit(&investor, &asset_token.address, &1_000_000);

    env.ledger().with_mut(|l| l.timestamp += 365 * 24 * 60 * 60); // +1 year
    vault.accrue_management_fee();

    // 10% of 1_000_000 supply over 1 year ~= 100_000
    assert_eq!(vault.balance(&fee_recipient), 100_000);
}

// ─── Governance mode ─────────────────────────────────────────────────────

mod governance_mode {
    use super::*;
    use crate::governance::{Action, ProposalState};
    use ankara_common::governance::GovernanceConfig;

    const DAY: u64 = 86_400;
    const E18: i128 = 1_000_000_000_000_000_000;

    fn gov_config() -> GovernanceConfig {
        GovernanceConfig {
            voting_period: 3 * DAY,
            timelock: 2 * DAY,
            quorum_bps: 2_000,          // 20% of supply must vote
            proposal_threshold_bps: 100, // 1% to propose
        }
    }

    struct Gov<'a> {
        admin: Address,
        a: Address,
        b: Address,
        c: Address,
        vault: PoolVaultClient<'a>,
        oracle: ManualOracleClient<'a>,
    }

    /// Vault with shares a=600, b=300, c=100, governance enabled.
    fn setup_gov(env: &Env) -> Gov<'_> {
        env.ledger().with_mut(|l| l.timestamp = 1_700_000_000);
        let (admin, vault) = setup(env);
        let asset = deploy_asset_token(env, &admin);
        let oracle = deploy_oracle(env, &admin);
        vault.add_accepted_token(&asset.address, &10_000);
        vault.set_oracle(&oracle.address);
        oracle.set_price(&asset.address, &E18);
        let (a, b, c) = (Address::generate(env), Address::generate(env), Address::generate(env));
        for (who, amt) in [(&a, 600), (&b, 300), (&c, 100)] {
            asset.mint(who, &amt);
            vault.deposit(who, &asset.address, &amt);
        }
        vault.enable_governance(&gov_config());
        Gov { admin, a, b, c, vault, oracle }
    }

    fn after(env: &Env, secs: u64) {
        env.ledger().with_mut(|l| l.timestamp += secs);
    }

    #[test]
    fn default_mode_is_unchanged() {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        let (_, vault) = setup(&env);
        assert!(vault.governance_config().is_none());
        vault.set_management_fee_bps(&75);
        assert_eq!(vault.management_fee_bps(), 75);
        assert!(vault
            .try_propose(&Address::generate(&env), &Action::SetManagementFeeBps(1))
            .is_err());
    }

    #[test]
    fn governed_vault_blocks_direct_manager_actions() {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        let g = setup_gov(&env);
        assert_eq!(g.vault.governance_config(), Some(gov_config()));
        assert!(g.vault.try_set_management_fee_bps(&999).is_err());
        assert!(g.vault.try_set_oracle(&Address::generate(&env)).is_err());
        assert!(g.vault.try_add_accepted_token(&Address::generate(&env), &1).is_err());
        assert!(g.vault.try_set_min_deposit(&g.oracle.address, &1).is_err());
        assert!(g.vault.try_upgrade(&BytesN::from_array(&env, &[0u8; 32])).is_err());
        assert!(g.vault.try_mint(&g.admin, &1_000_000).is_err());
        // One-way.
        assert!(g.vault.try_enable_governance(&gov_config()).is_err());
    }

    #[test]
    fn proposal_passes_waits_timelock_and_executes() {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        let g = setup_gov(&env);
        let id = g.vault.propose(&g.c, &Action::SetManagementFeeBps(25));
        assert_eq!(g.vault.proposal_state(&id), ProposalState::Active);
        assert_eq!(g.vault.get_proposal(&id).quorum_votes, 200);

        g.vault.vote(&g.a, &id, &true);
        g.vault.vote(&g.b, &id, &false);
        assert!(g.vault.has_voted(&id, &g.a));
        assert!(g.vault.try_vote(&g.a, &id, &true).is_err()); // once
        let p = g.vault.get_proposal(&id);
        assert_eq!((p.for_votes, p.against_votes), (600, 300));

        assert!(g.vault.try_execute(&id).is_err()); // still voting
        after(&env, 3 * DAY + 1);
        assert_eq!(g.vault.proposal_state(&id), ProposalState::Queued);
        assert!(g.vault.try_execute(&id).is_err()); // timelock
        assert!(g.vault.try_vote(&g.c, &id, &true).is_err()); // closed
        after(&env, 2 * DAY);
        assert_eq!(g.vault.proposal_state(&id), ProposalState::Executable);
        g.vault.execute(&id);
        assert_eq!(g.vault.management_fee_bps(), 25);
        assert_eq!(g.vault.proposal_state(&id), ProposalState::Executed);
        assert!(g.vault.try_execute(&id).is_err());
    }

    #[test]
    fn oracle_and_token_list_changes_go_through_proposals() {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        let g = setup_gov(&env);
        let new_oracle = Address::generate(&env);
        let new_token = Address::generate(&env);
        let p1 = g.vault.propose(&g.a, &Action::SetOracle(new_oracle.clone()));
        let p2 = g.vault.propose(&g.a, &Action::AddAcceptedToken(new_token.clone(), 2_500));
        g.vault.vote(&g.a, &p1, &true);
        g.vault.vote(&g.a, &p2, &true);
        after(&env, 5 * DAY + 1);
        g.vault.execute(&p1);
        g.vault.execute(&p2);
        assert_eq!(g.vault.oracle(), Some(new_oracle));
        assert!(g.vault.is_accepted(&new_token));
        assert_eq!(g.vault.token_weight(&new_token), 2_500);
    }

    #[test]
    fn defeated_by_majority_or_quorum() {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        let g = setup_gov(&env);
        let majority_no = g.vault.propose(&g.c, &Action::SetManagementFeeBps(1));
        g.vault.vote(&g.c, &majority_no, &true);
        g.vault.vote(&g.b, &majority_no, &false);
        let no_quorum = g.vault.propose(&g.c, &Action::SetManagementFeeBps(2));
        g.vault.vote(&g.c, &no_quorum, &true); // 100 < 200 quorum
        after(&env, 10 * DAY);
        assert_eq!(g.vault.proposal_state(&majority_no), ProposalState::Defeated);
        assert_eq!(g.vault.proposal_state(&no_quorum), ProposalState::Defeated);
        assert!(g.vault.try_execute(&majority_no).is_err());
        assert!(g.vault.try_execute(&no_quorum).is_err());
    }

    #[test]
    fn proposal_threshold_and_cancel() {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        let g = setup_gov(&env);
        let outsider = Address::generate(&env);
        assert!(g.vault.try_propose(&outsider, &Action::SetManagementFeeBps(1)).is_err());
        let id = g.vault.propose(&g.b, &Action::SetManagementFeeBps(1));
        assert!(g.vault.try_cancel_proposal(&g.a, &id).is_err());
        g.vault.cancel_proposal(&g.b, &id);
        assert_eq!(g.vault.proposal_state(&id), ProposalState::Cancelled);
        assert!(g.vault.try_vote(&g.a, &id, &true).is_err());
        assert_eq!(g.vault.proposal_count(), 1);
    }

    #[test]
    fn voted_shares_are_locked_until_voting_ends() {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        let g = setup_gov(&env);
        let id = g.vault.propose(&g.a, &Action::SetManagementFeeBps(1));
        g.vault.vote(&g.b, &id, &false);
        assert_eq!(g.vault.locked_balance(&g.b), 300);

        // Can't move the voted shares to a fresh address to vote again.
        let sybil = Address::generate(&env);
        assert!(g.vault.try_transfer(&g.b, &sybil, &1).is_err());
        assert!(g.vault.try_withdraw(&g.b, &1).is_err());
        assert!(g.vault.try_burn(&g.b, &1).is_err());

        after(&env, 3 * DAY + 1);
        assert_eq!(g.vault.locked_balance(&g.b), 0);
        g.vault.transfer(&g.b, &sybil, &100);
        assert_eq!(g.vault.balance(&sybil), 100);
    }

    #[test]
    fn invalid_config_rejected_and_initialize_governed() {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        let (_, vault) = setup(&env);
        let bad = GovernanceConfig { voting_period: 0, timelock: 0, quorum_bps: 1, proposal_threshold_bps: 0 };
        assert!(vault.try_enable_governance(&bad).is_err());

        let id = env.register(PoolVault, ());
        let governed = PoolVaultClient::new(&env, &id);
        governed.initialize_governed(
            &String::from_str(&env, "Coop Fund"),
            &String::from_str(&env, "COOP"),
            &BytesN::from_array(&env, &[4u8; 32]),
            &String::from_str(&env, "NG"),
            &Address::generate(&env),
            &None,
            &None,
            &None,
            &0,
            &gov_config(),
        );
        assert!(governed.governance_config().is_some());
        assert!(governed.try_set_management_fee_bps(&1).is_err());
    }
}
