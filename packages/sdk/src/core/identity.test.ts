import { describe, it, expect, vi } from "vitest";
import { hash } from "@stellar/stellar-sdk";
import { WhitelistVerifier } from "./WhitelistVerifier";
import { AttestationRegistry, encodeSubject } from "./AttestationRegistry";
import type { StellarAdapter } from "../adapters/stellar";

const ADDR = "CREGISTRY";

function mockAdapter(results: Record<string, unknown> = {}) {
  const invokeContract = vi.fn(async (_id: string, method: string) => ({
    result: results[method], txHash: `tx-${method}`,
  }));
  const readContract = vi.fn(async (_id: string, method: string) => results[method]);
  const adapter = {
    invokeContract,
    readContract,
    getSignerAddress: vi.fn(async () => "GSIGNER"),
  } as unknown as StellarAdapter;
  return { adapter, invokeContract, readContract };
}

describe("WhitelistVerifier", () => {
  it("routes writes to the right contract methods with snake_case args", async () => {
    const { adapter, invokeContract } = mockAdapter();
    const v = new WhitelistVerifier(adapter, ADDR);
    expect(await v.verify("GALICE")).toBe("tx-verify");
    await v.verifyUntil("GBOB", 123n);
    await v.revoke("GALICE");
    await v.batchVerify(["GA", "GB"]);
    await v.transferAdmin("GNEW");
    expect(invokeContract).toHaveBeenCalledWith(ADDR, "verify", { account: "GALICE" });
    expect(invokeContract).toHaveBeenCalledWith(ADDR, "verify_until", { account: "GBOB", expires_at: 123n });
    expect(invokeContract).toHaveBeenCalledWith(ADDR, "revoke", { account: "GALICE" });
    expect(invokeContract).toHaveBeenCalledWith(ADDR, "batch_verify", { accounts: ["GA", "GB"] });
    expect(invokeContract).toHaveBeenCalledWith(ADDR, "transfer_admin", { new_admin: "GNEW" });
  });

  it("rejects batches over the contract limit before sending", async () => {
    const { adapter, invokeContract } = mockAdapter();
    const v = new WhitelistVerifier(adapter, ADDR);
    await expect(v.batchVerify(Array.from({ length: 51 }, (_, i) => `G${i}`))).rejects.toThrow(/limit of 50/);
    expect(invokeContract).not.toHaveBeenCalled();
  });

  it("decodes records and missing records", async () => {
    const { adapter } = mockAdapter({ get_record: { verified_at: 10n, expires_at: 0n }, is_verified: true });
    const v = new WhitelistVerifier(adapter, ADDR);
    expect(await v.getRecord("GALICE")).toEqual({ verifiedAt: 10n, expiresAt: 0n });
    expect(await v.isVerified("GALICE")).toBe(true);

    const none = new WhitelistVerifier(mockAdapter({ get_record: undefined }).adapter, ADDR);
    expect(await none.getRecord("GALICE")).toBeNull();
  });
});

describe("AttestationRegistry", () => {
  const raw = {
    id: 3n,
    subject: { tag: "Asset", values: [Buffer.alloc(32, 7)] },
    claim_type: "TITLE",
    attestor: "GATTESTOR",
    value: 0n,
    data: "deed=0xab",
    timestamp: 100n,
    expires_at: 0n,
    revoked: false,
  };

  it("encodes subjects as Soroban enum variants, hashing asset IDs like TokenFactory does", () => {
    expect(encodeSubject({ kind: "account", address: "GALICE" })).toEqual({ tag: "Account", values: ["GALICE"] });
    const asset = encodeSubject({ kind: "asset", assetId: "FARM-001" });
    expect(asset.tag).toBe("Asset");
    expect(Buffer.from(asset.values![0] as Buffer).equals(hash(Buffer.from("FARM-001")))).toBe(true);
    const hex = "0x" + "ab".repeat(32);
    const raw32 = encodeSubject({ kind: "asset", assetId: hex });
    expect(Buffer.from(raw32.values![0] as Buffer).toString("hex")).toBe("ab".repeat(32));
  });

  it("attests as the signer and returns the new id", async () => {
    const { adapter, invokeContract } = mockAdapter({ attest: 5n });
    const r = new AttestationRegistry(adapter, ADDR);
    const out = await r.attest({ subject: { kind: "account", address: "GALICE" }, claimType: "KYC", value: 2n });
    expect(out).toEqual({ attestationId: 5, txHash: "tx-attest" });
    expect(invokeContract).toHaveBeenCalledWith(ADDR, "attest", {
      attestor: "GSIGNER",
      subject: { tag: "Account", values: ["GALICE"] },
      claim_type: "KYC",
      value: 2n,
      data: "",
      expires_at: 0n,
    });
  });

  it("validates claim types as Soroban symbols", async () => {
    const r = new AttestationRegistry(mockAdapter().adapter, ADDR);
    await expect(r.attest({ subject: { kind: "account", address: "G" }, claimType: "has space", value: 1n }))
      .rejects.toThrow(/Invalid claim type/);
  });

  it("revokes as the signer", async () => {
    const { adapter, invokeContract } = mockAdapter();
    await new AttestationRegistry(adapter, ADDR).revoke(3);
    expect(invokeContract).toHaveBeenCalledWith(ADDR, "revoke", { caller: "GSIGNER", attestation_id: 3n });
  });

  it("decodes attestations, latest (incl. none) and history", async () => {
    const { adapter } = mockAdapter({ get_attestation: raw, latest: raw, history: [raw, raw], claim_count: 2, attestation_count: 9n });
    const r = new AttestationRegistry(adapter, ADDR);
    const a = await r.getAttestation(3);
    expect(a).toEqual({
      id: 3,
      subject: { kind: "asset", assetId: "0x" + "07".repeat(32) },
      claimType: "TITLE",
      attestor: "GATTESTOR",
      value: 0n,
      data: "deed=0xab",
      timestamp: 100n,
      expiresAt: 0n,
      revoked: false,
    });
    expect((await r.latest({ kind: "asset", assetId: "x" }, "TITLE"))?.id).toBe(3);
    expect(await r.history({ kind: "asset", assetId: "x" }, "TITLE")).toHaveLength(2);
    expect(await r.claimCount({ kind: "asset", assetId: "x" }, "TITLE")).toBe(2);
    expect(await r.attestationCount()).toBe(9);

    const empty = new AttestationRegistry(mockAdapter({ latest: undefined }).adapter, ADDR);
    expect(await empty.latest({ kind: "account", address: "G" }, "KYC")).toBeNull();
  });

  it("rejects oversized history pages", async () => {
    const r = new AttestationRegistry(mockAdapter().adapter, ADDR);
    await expect(r.history({ kind: "account", address: "G" }, "KYC", 0, 51)).rejects.toThrow(/page size/);
  });
});
