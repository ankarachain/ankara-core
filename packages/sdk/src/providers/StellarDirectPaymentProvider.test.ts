import { describe, it, expect, vi, beforeEach } from "vitest";
import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";

const TOML = {
  WEB_AUTH_ENDPOINT: "https://anchor.test/auth",
  DIRECT_PAYMENT_SERVER: "https://anchor.test/sep31",
  KYC_SERVER: "https://anchor.test/kyc",
  ANCHOR_QUOTE_SERVER: "https://anchor.test/sep38",
  CURRENCIES: [{ code: "USDC", issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" }],
};
const submitTransaction = vi.fn(async () => ({ hash: "stellar-tx-hash" }));
const loadAccount = vi.fn();

vi.mock("@stellar/stellar-sdk", async () => {
  const actual = await vi.importActual<typeof import("@stellar/stellar-sdk")>("@stellar/stellar-sdk");
  return {
    ...actual,
    StellarToml: { Resolver: { resolve: vi.fn(async () => TOML) } },
    Horizon: { ...actual.Horizon, Server: vi.fn().mockImplementation(() => ({ loadAccount, submitTransaction })) },
  };
});

import { StellarDirectPaymentProvider, mapSep31Status, receiverFieldsFromPayout } from "./StellarDirectPaymentProvider";
import { RampManager } from "../core/RampManager";
import { createRampProvider } from "./createRampProvider";
import { RampSessionStatus } from "../types";
import type { InitiateOffRampInput, StellarExternalSigner } from "../types";

const kp = Keypair.random();
const signer: StellarExternalSigner = {
  publicKey: kp.publicKey(),
  signTransaction: vi.fn(async (xdr: string, opts?: { networkPassphrase?: string }) => {
    const tx = TransactionBuilder.fromXDR(xdr, opts?.networkPassphrase ?? Networks.TESTNET);
    tx.sign(kp);
    return { signedTxXdr: tx.toXDR(), signerAddress: kp.publicKey() };
  }),
};

const OFFRAMP: InitiateOffRampInput = {
  tokenAmount: "250",
  tokenSymbol: "USDC",
  fiatCurrency: "KES",
  countryCode: "KE",
  payoutAccount: { type: "mobile-money", accountNumber: "+254700000000", provider: "M-PESA", accountName: "Wanjiru Kamau" },
};

type Call = { url: string; method: string; body?: unknown; auth?: string };
let calls: Call[];

function installFetch(routes: Record<string, unknown>) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : undefined, auth: headers.Authorization });
    const key = `${method} ${url.split("?")[0]}`;
    if (!(key in routes)) return new Response(`no route ${key}`, { status: 404 });
    return new Response(JSON.stringify(routes[key]), { status: 200 });
  }));
}

beforeEach(async () => {
  const { Account } = await import("@stellar/stellar-sdk");
  loadAccount.mockResolvedValue(new Account(kp.publicKey(), "1"));
  submitTransaction.mockClear();
});

describe("StellarDirectPaymentProvider (SEP-31)", () => {
  it("registers the receiver, creates the transaction and pays the anchor — no interactive step", async () => {
    installFetch({
      "PUT https://anchor.test/kyc/customer": { id: "receiver-1" },
      "POST https://anchor.test/sep31/transactions": { id: "tx-1" },
      "GET https://anchor.test/sep31/transactions/tx-1": {
        transaction: { id: "tx-1", status: "pending_sender", stellar_account_id: kp.publicKey(), stellar_memo: "12345", stellar_memo_type: "id" },
      },
    });
    const provider = new StellarDirectPaymentProvider({ homeDomain: "anchor.test", signer, senderId: "sender-9", authToken: "jwt" });
    const session = await provider.initiateOffRamp(OFFRAMP);

    expect(session.sessionId).toBe("tx-1");
    expect(session.paymentUrl).toBeUndefined();
    expect(session.status).toBe(RampSessionStatus.PROCESSING);
    expect(session.paymentTxHash).toBe("stellar-tx-hash");
    expect(session.paymentInstructions).toEqual({
      destination: kp.publicKey(), memo: "12345", memoType: "id", amount: "250", assetCode: "USDC", assetIssuer: TOML.CURRENCIES[0].issuer,
    });

    const kyc = calls.find((c) => c.method === "PUT")!;
    expect(kyc.auth).toBe("Bearer jwt");
    expect(kyc.body).toMatchObject({ type: "sep31-receiver", first_name: "Wanjiru", last_name: "Kamau", mobile_money_number: "+254700000000", mobile_money_provider: "M-PESA" });
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body).toMatchObject({ amount: "250", asset_code: "USDC", sender_id: "sender-9", receiver_id: "receiver-1", destination_asset: "iso4217:KES" });

    expect(submitTransaction).toHaveBeenCalledTimes(1);
    const tx = (submitTransaction.mock.calls[0] as unknown[])[0] as { memo: { type: string; value: unknown }; operations: Array<{ destination: string; amount: string }> };
    expect(tx.memo.type).toBe("id");
    expect(tx.operations[0].amount).toBe("250.0000000");
  });

  it("with autoPay=false only returns payment instructions", async () => {
    installFetch({
      "PUT https://anchor.test/kyc/customer": { id: "r" },
      "POST https://anchor.test/sep31/transactions": { id: "tx-2", stellar_account_id: kp.publicKey(), stellar_memo: "abc", stellar_memo_type: "text" },
    });
    const provider = new StellarDirectPaymentProvider({ homeDomain: "anchor.test", signer, senderId: "s", authToken: "jwt", autoPay: false });
    const session = await provider.initiateOffRamp(OFFRAMP);
    expect(session.status).toBe(RampSessionStatus.PENDING);
    expect(session.paymentTxHash).toBeUndefined();
    expect(session.paymentInstructions?.memo).toBe("abc");
    expect(submitTransaction).not.toHaveBeenCalled();
  });

  it("maps statuses and polls GET /transactions/:id", async () => {
    installFetch({ "GET https://anchor.test/sep31/transactions/tx-3": { transaction: { id: "tx-3", status: "completed" } } });
    const provider = new StellarDirectPaymentProvider({ homeDomain: "anchor.test", signer, senderId: "s", authToken: "jwt" });
    expect(await provider.getStatus("tx-3")).toBe(RampSessionStatus.SETTLED);
    expect(mapSep31Status("pending_sender")).toBe(RampSessionStatus.PENDING);
    expect(mapSep31Status("pending_receiver")).toBe(RampSessionStatus.PROCESSING);
    expect(mapSep31Status("error")).toBe(RampSessionStatus.FAILED);
    expect(mapSep31Status("refunded")).toBe(RampSessionStatus.REFUNDED);
  });

  it("quotes via SEP-38 with context=sep31 and refuses on-ramp", async () => {
    installFetch({ "GET https://anchor.test/sep38/price": { price: "130.5", sell_amount: "100", buy_amount: "13050", fee: { total: "1.2" } } });
    const provider = new StellarDirectPaymentProvider({ homeDomain: "anchor.test", signer, senderId: "s", authToken: "jwt" });
    const quote = await provider.getQuote({ direction: "off-ramp", fiatCurrency: "KES", tokenSymbol: "USDC", countryCode: "KE", tokenAmount: "100" });
    expect(quote).toMatchObject({ fiatAmount: "13050", tokenAmount: "100", exchangeRate: "130.5", feeFiat: "1.2" });
    expect(calls[0].url).toContain("context=sep31");
    expect(calls[0].url).toContain(encodeURIComponent(`stellar:USDC:${TOML.CURRENCIES[0].issuer}`));
    await expect(provider.initiateOnRamp({ fiatAmount: "1", fiatCurrency: "KES", tokenSymbol: "USDC", recipientAddress: "G", countryCode: "KE" }))
      .rejects.toThrow(/send-side only/);
  });

  it("plugs into RampManager and createRampProvider", async () => {
    installFetch({ "GET https://anchor.test/sep31/transactions/tx-4": { transaction: { id: "tx-4", status: "pending_external" } } });
    const provider = createRampProvider({ provider: "stellar-sep31", homeDomain: "anchor.test", senderId: "s" }, { stellarSigner: signer });
    expect(provider).toBeInstanceOf(StellarDirectPaymentProvider);
    const direct = new StellarDirectPaymentProvider({ homeDomain: "anchor.test", signer, senderId: "s", authToken: "jwt" });
    const ramp = RampManager.withProviders({ onRamp: direct, offRamp: direct });
    expect(await ramp.getStatus("tx-4")).toBe(RampSessionStatus.PROCESSING);
    expect(() => createRampProvider({ provider: "stellar-sep31", homeDomain: "x", senderId: "s" })).toThrow(/stellarSigner/);
  });

  it("derives SEP-9 bank fields", () => {
    expect(receiverFieldsFromPayout({ ...OFFRAMP, payoutAccount: { type: "bank", accountNumber: "0123", bankCode: "058", accountName: "Ada" } }))
      .toEqual({ first_name: "Ada", bank_account_number: "0123", bank_number: "058", address_country_code: "KE" });
  });
});
