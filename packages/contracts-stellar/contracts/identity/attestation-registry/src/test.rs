#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, BytesN, Env, String, Symbol,
};

use farmland_token::{FarmlandMetadata, FarmlandToken, FarmlandTokenClient};

use crate::contract::{AttestationRegistry, AttestationRegistryClient};
use crate::storage::Subject;

struct Setup<'a> {
    admin: Address,
    attestor: Address,
    registry: AttestationRegistryClient<'a>,
}

fn setup(env: &Env) -> Setup<'_> {
    env.ledger().with_mut(|l| l.timestamp = 1_700_000_000);
    let admin = Address::generate(env);
    let attestor = Address::generate(env);
    let id = env.register(AttestationRegistry, ());
    let registry = AttestationRegistryClient::new(env, &id);
    registry.initialize(&admin);
    registry.add_attestor(&attestor);
    Setup { admin, attestor, registry }
}

fn s(env: &Env, v: &str) -> String {
    String::from_str(env, v)
}

#[test]
fn attest_and_read_back() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env);
    let user = Address::generate(&env);
    let subject = Subject::Account(user.clone());
    let credit = Symbol::new(&env, "CREDIT");

    let id = t.registry.attest(&t.attestor, &subject, &credit, &720, &s(&env, "model:v1"), &0);
    assert_eq!(id, 0);
    assert_eq!(t.registry.attestation_count(), 1);
    assert_eq!(t.registry.claim_count(&subject, &credit), 1);

    let a = t.registry.get_attestation(&id);
    assert_eq!(a.value, 720);
    assert_eq!(a.attestor, t.attestor);
    assert_eq!(a.timestamp, 1_700_000_000);
    assert!(!a.revoked);

    assert_eq!(t.registry.latest(&subject, &credit).unwrap().id, id);
    assert!(t.registry.has_valid_claim(&subject, &credit));
}

#[test]
fn latest_returns_newest_valid_and_history_keeps_everything() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env);
    let asset = Subject::Asset(BytesN::from_array(&env, &[7u8; 32]));
    let title = Symbol::new(&env, "TITLE");

    let first = t.registry.attest(&t.attestor, &asset, &title, &0, &s(&env, "owner:A deed:0xaa"), &0);
    env.ledger().with_mut(|l| l.timestamp += 10);
    let second = t.registry.attest(&t.attestor, &asset, &title, &0, &s(&env, "owner:B deed:0xbb"), &0);

    assert_eq!(t.registry.latest(&asset, &title).unwrap().id, second);

    // Revoking the newest falls back to the previous valid entry.
    t.registry.revoke(&t.attestor, &second);
    assert_eq!(t.registry.latest(&asset, &title).unwrap().id, first);

    let history = t.registry.history(&asset, &title, &0, &10);
    assert_eq!(history.len(), 2);
    assert_eq!(history.get(0).unwrap().id, first);
    assert!(history.get(1).unwrap().revoked);

    // Pagination.
    let page = t.registry.history(&asset, &title, &1, &10);
    assert_eq!(page.len(), 1);
    assert_eq!(page.get(0).unwrap().id, second);
    assert_eq!(t.registry.history(&asset, &title, &5, &10).len(), 0);
}

#[test]
fn claims_expire() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env);
    let subject = Subject::Account(Address::generate(&env));
    let kyc = Symbol::new(&env, "KYC");

    t.registry.attest(&t.attestor, &subject, &kyc, &1, &s(&env, ""), &(1_700_000_000 + 60));
    assert!(t.registry.has_valid_claim(&subject, &kyc));
    env.ledger().with_mut(|l| l.timestamp += 60);
    assert!(!t.registry.has_valid_claim(&subject, &kyc));
    assert!(t.registry.latest(&subject, &kyc).is_none());
}

#[test]
fn claim_types_and_subjects_are_isolated() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env);
    let a = Subject::Account(Address::generate(&env));
    let b = Subject::Account(Address::generate(&env));
    let kyc = Symbol::new(&env, "KYC");
    let credit = Symbol::new(&env, "CREDIT");

    t.registry.attest(&t.attestor, &a, &kyc, &1, &s(&env, ""), &0);
    assert!(!t.registry.has_valid_claim(&a, &credit));
    assert!(!t.registry.has_valid_claim(&b, &kyc));
}

#[test]
fn non_attestor_cannot_attest() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env);
    let stranger = Address::generate(&env);
    let result = t.registry.try_attest(
        &stranger,
        &Subject::Account(stranger.clone()),
        &Symbol::new(&env, "KYC"),
        &1,
        &s(&env, ""),
        &0,
    );
    assert!(result.is_err());
}

#[test]
fn removed_attestor_cannot_attest() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env);
    t.registry.remove_attestor(&t.attestor);
    assert!(!t.registry.is_attestor(&t.attestor));
    let result = t.registry.try_attest(
        &t.attestor,
        &Subject::Account(t.admin.clone()),
        &Symbol::new(&env, "KYC"),
        &1,
        &s(&env, ""),
        &0,
    );
    assert!(result.is_err());
}

#[test]
fn revoke_permissions() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env);
    let other_attestor = Address::generate(&env);
    t.registry.add_attestor(&other_attestor);
    let subject = Subject::Account(Address::generate(&env));
    let kyc = Symbol::new(&env, "KYC");
    let id = t.registry.attest(&t.attestor, &subject, &kyc, &1, &s(&env, ""), &0);

    // A different attestor can't revoke someone else's claim.
    assert!(t.registry.try_revoke(&other_attestor, &id).is_err());
    // The Manager can.
    t.registry.revoke(&t.admin, &id);
    assert!(t.registry.get_attestation(&id).revoked);
    // Double revoke is rejected.
    assert!(t.registry.try_revoke(&t.admin, &id).is_err());
}

#[test]
fn rejects_past_expiry_and_oversized_pages() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env);
    let subject = Subject::Account(Address::generate(&env));
    let kyc = Symbol::new(&env, "KYC");
    assert!(t
        .registry
        .try_attest(&t.attestor, &subject, &kyc, &1, &s(&env, ""), &5)
        .is_err());
    assert!(t.registry.try_history(&subject, &kyc, &0, &51).is_err());
}

#[test]
fn works_as_identity_verifier_for_templates() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env);
    let alice = Address::generate(&env);
    let kyc = Symbol::new(&env, "KYC");

    let token_id = env.register(FarmlandToken, ());
    let token = FarmlandTokenClient::new(&env, &token_id);
    token.initialize(
        &s(&env, "Farm"),
        &s(&env, "FARM"),
        &BytesN::from_array(&env, &[1u8; 32]),
        &s(&env, "NG"),
        &t.admin,
        &Some(t.registry.address.clone()),
        &None,
        &FarmlandMetadata {
            location: s(&env, "n/a"),
            area_sq_meters: 0,
            soil_type: s(&env, "n/a"),
            irrigation_type: s(&env, "n/a"),
            crop_history: s(&env, "n/a"),
            title_document_hash: BytesN::from_array(&env, &[0u8; 32]),
            valuation_usd: 0,
            state_region: s(&env, "n/a"),
            last_updated: 0,
        },
    );

    assert!(!t.registry.is_verified(&alice));
    assert!(token.try_mint(&alice, &100).is_err());

    // A value of 0 records "checked, not passed" — still not verified.
    t.registry.attest(&t.attestor, &Subject::Account(alice.clone()), &kyc, &0, &s(&env, ""), &0);
    assert!(!t.registry.is_verified(&alice));

    let pass = t.registry.attest(&t.attestor, &Subject::Account(alice.clone()), &kyc, &2, &s(&env, "tier2"), &0);
    assert!(t.registry.is_verified(&alice));
    token.mint(&alice, &100);
    assert_eq!(token.balance(&alice), 100);

    t.registry.revoke(&t.attestor, &pass);
    // Latest valid is now the value-0 entry -> not verified.
    assert!(!t.registry.is_verified(&alice));
}

#[test]
fn verifier_claim_type_is_configurable() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup(&env);
    let alice = Address::generate(&env);
    assert_eq!(t.registry.verifier_claim_type(), Symbol::new(&env, "KYC"));

    let accredited = Symbol::new(&env, "ACCREDITED");
    t.registry.set_verifier_claim_type(&accredited);
    t.registry.attest(&t.attestor, &Subject::Account(alice.clone()), &Symbol::new(&env, "KYC"), &1, &s(&env, ""), &0);
    assert!(!t.registry.is_verified(&alice));
    t.registry.attest(&t.attestor, &Subject::Account(alice.clone()), &accredited, &1, &s(&env, ""), &0);
    assert!(t.registry.is_verified(&alice));
}

#[test]
#[should_panic]
fn add_attestor_requires_manager() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let id = env.register(AttestationRegistry, ());
    let registry = AttestationRegistryClient::new(&env, &id);
    registry.initialize(&admin);
    registry.add_attestor(&Address::generate(&env));
}
