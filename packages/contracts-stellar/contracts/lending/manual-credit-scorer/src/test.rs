#![cfg(test)]

use soroban_sdk::{testutils::{Address as _, Ledger as _}, vec, Address, Env};

use crate::contract::{ManualCreditScorer, ManualCreditScorerClient, ScoreEntry};

fn setup(env: &Env) -> ManualCreditScorerClient<'_> {
    env.ledger().with_mut(|l| l.timestamp = 1_000);
    let id = env.register(ManualCreditScorer, ());
    let c = ManualCreditScorerClient::new(env, &id);
    c.initialize(&Address::generate(env));
    c
}

#[test]
fn set_read_batch_remove() {
    let env = Env::default();
    env.mock_all_auths();
    let c = setup(&env);
    let (a, b) = (Address::generate(&env), Address::generate(&env));
    assert!(c.credit_score(&a).is_none());
    c.set_score(&a, &700);
    let s = c.credit_score(&a).unwrap();
    assert_eq!((s.score, s.updated_at), (700, 1_000));
    c.batch_set_scores(&vec![&env, ScoreEntry { borrower: a.clone(), score: 650 }, ScoreEntry { borrower: b.clone(), score: 500 }]);
    assert_eq!(c.credit_score(&a).unwrap().score, 650);
    assert_eq!(c.credit_score(&b).unwrap().score, 500);
    c.remove_score(&a);
    assert!(c.credit_score(&a).is_none());
}

#[test]
#[should_panic]
fn set_score_requires_manager() {
    let env = Env::default();
    let c = setup(&env);
    c.set_score(&Address::generate(&env), &1);
}
