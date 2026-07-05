#![cfg(test)]

use ankara_common::AssetStatus;
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, String};

use crate::contract::{InvoiceToken, InvoiceTokenClient};
use crate::metadata::{InvoiceMetadata, InvoiceStatus};

fn sample_metadata(env: &Env) -> InvoiceMetadata {
    InvoiceMetadata {
        invoice_number: String::from_str(env, "INV-2026-001"),
        debtor_reference: String::from_str(env, "DEBTOR-001"),
        face_value_usd: 10_000_0000000_i128,
        discount_rate_bps: 250,
        issuance_date: 1_000,
        due_date: 90 * 86_400,
        invoice_document_hash: BytesN::from_array(env, &[5u8; 32]),
        currency: String::from_str(env, "NGN"),
        last_updated: 0,
    }
}

fn setup(env: &Env) -> (Address, InvoiceTokenClient<'_>) {
    let admin = Address::generate(env);
    let contract_id = env.register(InvoiceToken, ());
    let client = InvoiceTokenClient::new(env, &contract_id);
    client.initialize(
        &String::from_str(env, "Lagos SME Invoice"),
        &String::from_str(env, "LSI"),
        &BytesN::from_array(env, &[6u8; 32]),
        &String::from_str(env, "NG"),
        &admin,
        &None,
        &None,
        &sample_metadata(env),
    );
    (admin, client)
}

#[test]
fn initialize_sets_pending_status() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env);
    assert_eq!(client.invoice_status(), InvoiceStatus::Pending);
    assert_eq!(client.status(), AssetStatus::Draft);
}

#[test]
fn full_lifecycle_funded_then_repaid() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env);

    client.mark_funded();
    assert_eq!(client.invoice_status(), InvoiceStatus::Funded);
    assert_eq!(client.status(), AssetStatus::Active);

    client.mark_repaid();
    assert_eq!(client.invoice_status(), InvoiceStatus::Repaid);
    assert_eq!(client.status(), AssetStatus::Redeemed);
}

#[test]
#[should_panic]
fn cannot_update_metadata_after_repaid() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env);

    client.mark_funded();
    client.mark_repaid();
    client.update_metadata(&sample_metadata(&env));
}

#[test]
fn mark_defaulted_sets_suspended() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env);

    client.mark_funded();
    client.mark_defaulted(&String::from_str(&env, "debtor insolvent"));

    assert_eq!(client.invoice_status(), InvoiceStatus::Defaulted);
    assert_eq!(client.status(), AssetStatus::Suspended);
}
