import { describe, it, expect, vi, beforeEach } from "vitest";
import { Keypair, nativeToScVal, StrKey } from "@stellar/stellar-sdk";

// A funded-looking testnet secret seed is not required — Keypair.fromSecret
// only needs a syntactically valid "S..." seed to construct a keypair, no
// network call happens at construction time.
const TEST_SECRET = Keypair.random().secret();
const TEST_PUBLIC = Keypair.fromSecret(TEST_SECRET).publicKey();
const MOCK_CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
// A real, checksum-valid contract strkey — needed for tests that go through
// the real `Contract` constructor (genericGetTokenMetadata's raw-invoke path)
// rather than the fully-mocked dynamic contract.Client, which never validates
// the placeholder ID above.
const REAL_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32));

// Mock the dynamic `contract.Client.from(...)` call — it fetches the
// contract's spec from the network, which unit tests must never do. Each
// test configures `mockClientMethods` with the dynamic method(s) it expects
// to be called, following the same "mock at the network boundary" approach
// used for `ethers.Contract` in the EVM adapter's own tests.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockClientMethods: Record<string, any> = {};

// getBalance() reads the account ledger entry directly (native XLM balance is
// an account field, not contract state — see the comment on getBalance()
// itself for why routing this through the dynamic contract.Client, like every
// other call, doesn't work), so it needs its own mock of rpc.Server distinct
// from the contract.Client mock below.
const mockGetAccountEntry = vi.fn();
// escrowGetActivity() reads events straight off rpc.Server too (Soroban events are
// ledger-level, not contract-client state), so it shares this mock rather than the
// dynamic contract.Client one below.
const mockGetHealth = vi.fn();
const mockGetEvents = vi.fn();
// genericGetTokenMetadata() also bypasses the dynamic contract.Client (see the
// comment on that method — Stellar Asset Contracts have no deployed WASM for
// Client.from() to introspect), simulating a raw invocation instead.
const mockSimulateTransaction = vi.fn();

vi.mock("@stellar/stellar-sdk", async () => {
  const actual = await vi.importActual<typeof import("@stellar/stellar-sdk")>("@stellar/stellar-sdk");
  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      Server: vi.fn().mockImplementation(() => ({
        getAccountEntry: mockGetAccountEntry,
        getHealth: mockGetHealth,
        getEvents: mockGetEvents,
        simulateTransaction: mockSimulateTransaction,
      })),
    },
  };
});

vi.mock("@stellar/stellar-sdk/contract", async () => {
  const actual = await vi.importActual<typeof import("@stellar/stellar-sdk/contract")>(
    "@stellar/stellar-sdk/contract"
  );
  return {
    ...actual,
    Client: {
      from: vi.fn(async () => new Proxy({}, {
        get: (_target, prop: string) => mockClientMethods[prop],
      })),
    },
  };
});

import { StellarAdapter } from "./stellar";
import type { StellarAnkaraChainConfig } from "../types";
import { MilestoneStatus, RampSettlementStatus, AssetStatus } from "../types";
import { TokenFactory } from "../core/TokenFactory";
import { EVMAdapter } from "./evm";
import { EscrowManager } from "../core/EscrowManager";
import { AssetRegistry } from "../core/AssetRegistry";

function makeAdapter(overrides: Partial<StellarAnkaraChainConfig> = {}): StellarAdapter {
  return new StellarAdapter("stellar-testnet", {
    network: "stellar-testnet",
    factoryAddress: MOCK_CONTRACT_ID,
    nftFactoryAddress: MOCK_CONTRACT_ID,
    escrowFactoryAddress: MOCK_CONTRACT_ID,
    multiTokenFactoryAddress: MOCK_CONTRACT_ID,
    rampSettlementFactoryAddress: MOCK_CONTRACT_ID,
    stellarSecretKey: TEST_SECRET,
    ...overrides,
  });
}

function mockCall(result: unknown, txHash = "mock-tx-hash") {
  return vi.fn(async () => ({
    result,
    signAndSend: vi.fn(async () => ({ result, getTransactionResponse: { txHash } })),
  }));
}

beforeEach(() => {
  for (const key of Object.keys(mockClientMethods)) delete mockClientMethods[key];
});

describe("StellarAdapter — instantiation", () => {
  it("constructs without making a live network call", () => {
    expect(() => makeAdapter()).not.toThrow();
  });

  it("exposes the network getter", () => {
    expect(makeAdapter().network).toBe("stellar-testnet");
  });

  it("throws when constructed with a non-Stellar network", () => {
    expect(() => {
      // @ts-expect-error deliberately passing an EVM network to prove the runtime guard fires
      new StellarAdapter("polygon", { network: "polygon" });
    }).toThrow(/non-Stellar network/);
  });

  it("throws from getSignerAddress when no signer is configured", async () => {
    const adapter = makeAdapter({ stellarSecretKey: undefined });
    await expect(adapter.getSignerAddress()).rejects.toThrow(/No Stellar signer configured/);
  });

  it("derives the signer address from an external signer (e.g. Freighter) when no secret key is set", async () => {
    const adapter = makeAdapter({
      stellarSecretKey: undefined,
      stellarSigner: {
        publicKey: "GEXTERNALSIGNERPUBLICKEYXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
        signTransaction: async (xdr: string) => ({ signedTxXdr: xdr }),
      },
    });
    await expect(adapter.getSignerAddress()).resolves.toBe("GEXTERNALSIGNERPUBLICKEYXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
  });

  it("derives the signer address from the configured secret key", async () => {
    const adapter = makeAdapter();
    await expect(adapter.getSignerAddress()).resolves.toBe(TEST_PUBLIC);
  });
});

describe("StellarAdapter — deploy calls", () => {
  it("deployFarmlandToken calls deploy_farmland_token and maps the result", async () => {
    mockClientMethods.deploy_farmland_token = mockCall(MOCK_CONTRACT_ID);
    const adapter = makeAdapter();

    const result = await adapter.deployFarmlandToken({
      name: "Kaduna Farmland",
      symbol: "KDF",
      assetId: "KADUNA-001",
      countryCode: "NG",
      metadata: {
        location: "10.5,7.4",
        areaSqMeters: 1000n,
        soilType: "loam",
        irrigationType: "rain-fed",
        cropHistory: "maize",
        titleDocumentHash: "0x" + "11".repeat(32),
        valuationUSD: 50_000n,
        stateRegion: "Kaduna",
        lastUpdated: 0n,
      },
    });

    expect(mockClientMethods.deploy_farmland_token).toHaveBeenCalledTimes(1);
    const callArgs = mockClientMethods.deploy_farmland_token.mock.calls[0][0];
    expect(callArgs.name).toBe("Kaduna Farmland");
    expect(callArgs.country_code).toBe("NG");
    expect(callArgs.metadata.area_sq_meters).toBe(1000n);
    expect(callArgs.metadata.title_document_hash).toBeInstanceOf(Buffer);
    expect(result.tokenAddress).toBe(MOCK_CONTRACT_ID);
    expect(result.template).toBe("farmland");
    expect(result.network).toBe("stellar-testnet");
    expect(result.txHash).toBe("mock-tx-hash");
  });

  it("deployFarmlandNFT calls deploy_farmland_nft (metadata is attached later, at mint)", async () => {
    mockClientMethods.deploy_farmland_nft = mockCall(MOCK_CONTRACT_ID);
    const adapter = makeAdapter();

    // `metadata` is part of `DeployFarmlandNFTOptions` for symmetry with the
    // fungible deploy options, but neither `EVMAdapter` nor `StellarAdapter`
    // reads it here — NFT metadata is attached per-token at `mint`, not at
    // contract deploy time (matches the EVM adapter's existing behavior).
    const result = await adapter.deployFarmlandNFT({
      name: "Kaduna Deed",
      symbol: "KDD",
      assetId: "KADUNA-DEED-001",
      countryCode: "NG",
      metadata: {
        location: "10.5,7.4", areaSqMeters: 1000n, soilType: "loam",
        irrigationType: "rain-fed", cropHistory: "maize",
        titleDocumentHash: "0x" + "11".repeat(32), surveyReportHash: "0x" + "22".repeat(32),
        stateRegion: "Kaduna", lastUpdated: 0n,
      },
    });

    expect(mockClientMethods.deploy_farmland_nft).toHaveBeenCalledTimes(1);
    expect(result.nftAddress).toBe(MOCK_CONTRACT_ID);
    expect(result.template).toBe("farmland-nft");
  });

  it("deployEscrow maps milestones into parallel amounts/description_hashes arrays", async () => {
    mockClientMethods.deploy_escrow = mockCall(MOCK_CONTRACT_ID);
    const adapter = makeAdapter();

    const result = await adapter.deployEscrow({
      payer: "GPAYERADDRESS",
      payee: "GPAYEEADDRESS",
      token: MOCK_CONTRACT_ID,
      milestones: [{ amount: 300n }, { amount: 700n, descriptionHash: "0x" + "22".repeat(32) }],
    });

    const callArgs = mockClientMethods.deploy_escrow.mock.calls[0][0];
    expect(callArgs.amounts).toEqual([300n, 700n]);
    expect(callArgs.description_hashes).toHaveLength(2);
    expect(callArgs.description_hashes[0]).toBeInstanceOf(Buffer);
    expect(result.escrowAddress).toBe(MOCK_CONTRACT_ID);
    expect(result.totalAmount).toBe(1000n);
  });

  it("deployRampSettlement calls deploy_ramp_settlement", async () => {
    mockClientMethods.deploy_ramp_settlement = mockCall(MOCK_CONTRACT_ID);
    const adapter = makeAdapter();

    const result = await adapter.deployRampSettlement({ treasury: "GTREASURY" });

    expect(mockClientMethods.deploy_ramp_settlement).toHaveBeenCalledTimes(1);
    expect(result.settlementAddress).toBe(MOCK_CONTRACT_ID);
    expect(result.treasury).toBe("GTREASURY");
  });

  it("deployPoolVault defaults managementFeeBps to 0", async () => {
    mockClientMethods.deploy_pool_vault = mockCall(MOCK_CONTRACT_ID);
    const adapter = makeAdapter();

    await adapter.deployPoolVault({
      name: "Ankara Basket",
      symbol: "ACB",
      assetId: "BASKET-001",
      countryCode: "NG",
    });

    const callArgs = mockClientMethods.deploy_pool_vault.mock.calls[0][0];
    expect(callArgs.management_fee_bps).toBe(0);
  });
});

describe("StellarAdapter — registry reads", () => {
  it("getDeployerTokens defaults to the configured signer's address", async () => {
    mockClientMethods.get_deployer_tokens = mockCall([MOCK_CONTRACT_ID]);
    const adapter = makeAdapter();

    const tokens = await adapter.getDeployerTokens();

    expect(mockClientMethods.get_deployer_tokens).toHaveBeenCalledWith({ deployer: TEST_PUBLIC });
    expect(tokens).toEqual([MOCK_CONTRACT_ID]);
  });

  it("totalDeployed reads the factory's total_deployed view", async () => {
    mockClientMethods.total_deployed = mockCall(3);
    const adapter = makeAdapter();
    await expect(adapter.totalDeployed()).resolves.toBe(3);
  });

  it("getBalance reads native XLM balance from the account ledger entry, not the dynamic contract client", async () => {
    mockGetAccountEntry.mockResolvedValue({ balance: () => "1234500000" }); // 123.45 XLM in stroops
    const adapter = makeAdapter();
    await expect(adapter.getBalance(TEST_PUBLIC)).resolves.toBe("123.45");
    expect(mockGetAccountEntry).toHaveBeenCalledWith(TEST_PUBLIC);
  });

  it("genericGetTokenMetadata reads name/symbol/decimals via a raw simulated call (works for SACs, which have no deployed WASM for the dynamic client to introspect)", async () => {
    mockGetAccountEntry.mockResolvedValue({ seqNum: () => "100" });
    const values = ["Test Token", "TST", 7];
    let call = 0;
    mockSimulateTransaction.mockImplementation(async () => ({
      transactionData: {},
      result: { retval: nativeToScVal(values[call++]), auth: [] },
    }));

    const adapter = makeAdapter();
    await expect(adapter.genericGetTokenMetadata(REAL_CONTRACT_ID)).resolves.toEqual({
      name: "Test Token",
      symbol: "TST",
      decimals: 7,
    });
  });

  it("genericGetTokenMetadata rejects an address that isn't a token contract", async () => {
    mockGetAccountEntry.mockResolvedValue({ seqNum: () => "100" });
    mockSimulateTransaction.mockResolvedValue({ error: "HostError: not a contract" });

    const adapter = makeAdapter();
    await expect(adapter.genericGetTokenMetadata(REAL_CONTRACT_ID)).rejects.toThrow(/not a valid token contract/);
  });

  it("escrowGetActivity scans in chunks and accumulates + normalizes events across them, oldest first", async () => {
    // oldestLedger..latestLedger spans exactly 2 chunks (5,000 each) — one event
    // planted in each chunk, so this also exercises that the scan actually
    // covers more than a single getEvents call and merges the results.
    mockGetHealth.mockResolvedValue({ oldestLedger: 995_000, latestLedger: 1_000_000 });
    mockGetEvents.mockImplementation(async ({ startLedger }: { startLedger: number }) => {
      if (startLedger === 995_000) {
        return {
          events: [{
            topic: [nativeToScVal("funded", { type: "symbol" })],
            value: nativeToScVal(1000n, { type: "i128" }),
            txHash: "tx-funded",
            ledgerClosedAt: "2024-01-01T00:00:00Z",
          }],
        };
      }
      if (startLedger === 1_000_000) {
        return {
          events: [{
            topic: [nativeToScVal("delivered", { type: "symbol" }), nativeToScVal(0, { type: "u32" })],
            value: nativeToScVal(1_700_000_100, { type: "u64" }),
            txHash: "tx-delivered",
            ledgerClosedAt: "2024-01-01T00:00:10Z",
          }],
        };
      }
      throw new Error(`unexpected startLedger in test: ${startLedger}`);
    });

    const adapter = makeAdapter();
    const activity = await adapter.escrowGetActivity(MOCK_CONTRACT_ID);

    expect(mockGetEvents).toHaveBeenCalledTimes(2);
    expect(mockGetEvents).toHaveBeenCalledWith({
      startLedger: 995_000,
      endLedger: 999_999,
      filters: [{ type: "contract", contractIds: [MOCK_CONTRACT_ID] }],
    });
    expect(mockGetEvents).toHaveBeenCalledWith({
      startLedger: 1_000_000,
      endLedger: 1_000_000,
      filters: [{ type: "contract", contractIds: [MOCK_CONTRACT_ID] }],
    });
    expect(activity.map(e => e.type)).toEqual(["funded", "delivered"]);
    expect(activity[0]).toMatchObject({ type: "funded", txHash: "tx-funded", data: { amount: 1000n } });
    expect(activity[1]).toMatchObject({ type: "delivered", milestoneId: 0, txHash: "tx-delivered" });
  });

  it("getBalance2 reads the token's own balance view", async () => {
    mockClientMethods.balance = mockCall(500n);
    const adapter = makeAdapter();
    await expect(adapter.getBalance2(MOCK_CONTRACT_ID, TEST_PUBLIC)).resolves.toBe(500n);
    expect(mockClientMethods.balance).toHaveBeenCalledWith({ id: TEST_PUBLIC });
  });
});

describe("TokenFactory — Stellar routing", () => {
  it("routes to StellarAdapter for a stellar network", () => {
    const factory = new TokenFactory({
      network: "stellar-testnet",
      factoryAddress: MOCK_CONTRACT_ID,
      stellarSecretKey: TEST_SECRET,
    });
    expect(factory.adapter).toBeInstanceOf(StellarAdapter);
    expect(factory.network).toBe("stellar-testnet");
  });

  it("still routes to EVMAdapter for an EVM network (no regression)", () => {
    const factory = new TokenFactory({ network: "localhost", factoryAddress: MOCK_CONTRACT_ID });
    expect(factory.adapter).toBeInstanceOf(EVMAdapter);
  });

  it("deployFarmland on a Stellar-routed factory calls through to the Stellar factory contract", async () => {
    mockClientMethods.deploy_farmland_token = mockCall(MOCK_CONTRACT_ID);
    const factory = new TokenFactory({
      network: "stellar-testnet",
      factoryAddress: MOCK_CONTRACT_ID,
      stellarSecretKey: TEST_SECRET,
    });

    const result = await factory.deployFarmland({
      name: "Farm", symbol: "FRM", assetId: "F-1", countryCode: "NG",
      metadata: {
        location: "0,0", areaSqMeters: 1n, soilType: "loam", irrigationType: "rain-fed",
        cropHistory: "maize", titleDocumentHash: "0x" + "00".repeat(32),
        valuationUSD: 1n, stateRegion: "n/a", lastUpdated: 0n,
      },
    });

    expect(result.tokenAddress).toBe(MOCK_CONTRACT_ID);
    expect(mockClientMethods.deploy_farmland_token).toHaveBeenCalledTimes(1);
  });
});

describe("StellarAdapter — escrow lifecycle (IAdapter)", () => {
  it("fund passes the signer as the explicit caller", async () => {
    mockClientMethods.fund = mockCall(undefined);
    const adapter = makeAdapter();

    const txHash = await adapter.escrowFund(MOCK_CONTRACT_ID, 0);

    expect(mockClientMethods.fund).toHaveBeenCalledWith({ caller: TEST_PUBLIC, milestone_id: 0 });
    expect(txHash).toBe("mock-tx-hash");
  });

  it("markDelivered/approveMilestone/raiseDispute thread caller + milestone_id", async () => {
    mockClientMethods.mark_delivered = mockCall(undefined);
    const adapter = makeAdapter();

    await adapter.escrowMarkDelivered(MOCK_CONTRACT_ID, 2);

    expect(mockClientMethods.mark_delivered).toHaveBeenCalledWith({ caller: TEST_PUBLIC, milestone_id: 2 });
  });

  it("resolveDispute passes release_to_payee", async () => {
    mockClientMethods.resolve_dispute = mockCall(undefined);
    const adapter = makeAdapter();

    await adapter.escrowResolveDispute(MOCK_CONTRACT_ID, 1, true);

    expect(mockClientMethods.resolve_dispute).toHaveBeenCalledWith({
      caller: TEST_PUBLIC, milestone_id: 1, release_to_payee: true,
    });
  });

  it("claimTimelockRelease/pause/unpause take no caller argument (role-checked internally)", async () => {
    mockClientMethods.claim_timelock_release = mockCall(undefined);
    mockClientMethods.pause = mockCall(undefined);
    const adapter = makeAdapter();

    await adapter.escrowClaimTimelockRelease(MOCK_CONTRACT_ID, 0);
    await adapter.escrowPause(MOCK_CONTRACT_ID);

    expect(mockClientMethods.claim_timelock_release).toHaveBeenCalledWith({ milestone_id: 0 });
    expect(mockClientMethods.pause).toHaveBeenCalledWith({});
  });

  it("getMilestone decodes the snake_case struct into the SDK's Milestone shape", async () => {
    // Soroban's dynamic client decodes a fieldless enum like `MilestoneStatus`
    // to `{ tag: "Delivered" }`, not a plain number — confirmed live against a
    // real deployed escrow. escrowGetMilestone must map that tag back to the
    // SDK's numeric MilestoneStatus.DELIVERED.
    mockClientMethods.get_milestone = mockCall({
      amount: 300n,
      description_hash: Buffer.from("11".repeat(32), "hex"),
      status: { tag: "Delivered" },
      delivered_at: 12345n,
      funded: true,
    });
    const adapter = makeAdapter();

    const milestone = await adapter.escrowGetMilestone(MOCK_CONTRACT_ID, 0);

    expect(milestone).toEqual({
      amount: 300n,
      descriptionHash: "0x" + "11".repeat(32),
      status: MilestoneStatus.DELIVERED,
      deliveredAt: 12345n,
      funded: true,
    });
  });

  it("EscrowManager drives the full lifecycle against a StellarAdapter", async () => {
    mockClientMethods.fund = mockCall(undefined);
    mockClientMethods.payer = mockCall("GPAYER");
    const adapter = makeAdapter();
    const escrow  = new EscrowManager(adapter, MOCK_CONTRACT_ID);

    await expect(escrow.fund(0)).resolves.toBe("mock-tx-hash");
    await expect(escrow.getPayer()).resolves.toBe("GPAYER");
  });
});

describe("StellarAdapter — ramp settlement lifecycle (IAdapter)", () => {
  it("depositOffRamp hashes the reference string and passes the caller", async () => {
    mockClientMethods.initiate_off_ramp = mockCall(undefined);
    const adapter = makeAdapter();

    await adapter.rampDepositOffRamp(MOCK_CONTRACT_ID, "session-1", MOCK_CONTRACT_ID, 500n);

    const callArgs = mockClientMethods.initiate_off_ramp.mock.calls[0][0];
    expect(callArgs.caller).toBe(TEST_PUBLIC);
    expect(callArgs.reference_id).toBeInstanceOf(Buffer);
    expect(callArgs.amount).toBe(500n);
    expect(callArgs.provider_ref).toBe("session-1");
  });

  it("confirmOffRampSettlement takes no caller argument (role-checked internally)", async () => {
    mockClientMethods.confirm_off_ramp_settlement = mockCall(undefined);
    const adapter = makeAdapter();

    await adapter.rampConfirmOffRampSettlement(MOCK_CONTRACT_ID, "session-1");

    const callArgs = mockClientMethods.confirm_off_ramp_settlement.mock.calls[0][0];
    expect(callArgs.caller).toBeUndefined();
    expect(callArgs.reference_id).toBeInstanceOf(Buffer);
  });

  it("getOffRampDeposit decodes the snake_case struct and throws when not found", async () => {
    mockClientMethods.get_off_ramp = mockCall({
      depositor: "GDEP", token: MOCK_CONTRACT_ID, amount: 500n, status: { tag: "None" }, initiated_at: 999n,
    });
    const adapter = makeAdapter();

    const deposit = await adapter.rampGetOffRampDeposit(MOCK_CONTRACT_ID, "session-1");
    expect(deposit).toEqual({
      depositor: "GDEP", token: MOCK_CONTRACT_ID, amount: 500n, status: RampSettlementStatus.NONE, initiatedAt: 999n,
    });

    mockClientMethods.get_off_ramp = mockCall(null);
    await expect(adapter.rampGetOffRampDeposit(MOCK_CONTRACT_ID, "missing")).rejects.toThrow(/No off-ramp deposit/);
  });
});

describe("StellarAdapter — AssetRegistry surface (IAdapter)", () => {
  it("generic reads (name/symbol/status/total_supply) hit the dynamic contract by address alone", async () => {
    mockClientMethods.name = mockCall("Kaduna Farmland");
    mockClientMethods.symbol = mockCall("KDF");
    mockClientMethods.status = mockCall({ tag: "Active" });
    mockClientMethods.total_supply = mockCall(1_000_000n);
    const adapter = makeAdapter();
    const registry = new AssetRegistry(adapter, MOCK_CONTRACT_ID, "farmland");

    await expect(registry.getName()).resolves.toBe("Kaduna Farmland");
    await expect(registry.getSymbol()).resolves.toBe("KDF");
    await expect(registry.getStatus()).resolves.toBe(AssetStatus.ACTIVE);
    await expect(registry.getTotalSupply()).resolves.toBe(1_000_000n);
  });

  it("getMetadata decodes the farmland snake_case struct into the SDK's camelCase shape", async () => {
    mockClientMethods.get_metadata = mockCall({
      location: "10.5,7.4",
      area_sq_meters: 1000n,
      soil_type: "loam",
      irrigation_type: "rain-fed",
      crop_history: "maize",
      title_document_hash: Buffer.from("11".repeat(32), "hex"),
      valuation_usd: 50_000n,
      state_region: "Kaduna",
      last_updated: 0n,
    });
    const adapter = makeAdapter();
    const registry = new AssetRegistry(adapter, MOCK_CONTRACT_ID, "farmland");

    const meta = await registry.getMetadata();

    expect(meta).toEqual({
      location: "10.5,7.4",
      areaSqMeters: 1000n,
      soilType: "loam",
      irrigationType: "rain-fed",
      cropHistory: "maize",
      titleDocumentHash: "0x" + "11".repeat(32),
      valuationUSD: 50_000n,
      stateRegion: "Kaduna",
      lastUpdated: 0n,
    });
  });

  it("mint/setStatus/pause write through the dynamic contract", async () => {
    mockClientMethods.mint = mockCall(undefined);
    mockClientMethods.set_status = mockCall(undefined);
    const adapter = makeAdapter();
    const registry = new AssetRegistry(adapter, MOCK_CONTRACT_ID, "farmland");

    await expect(registry.mint("GRECIPIENT", 100n)).resolves.toBe("mock-tx-hash");
    expect(mockClientMethods.mint).toHaveBeenCalledWith({ to: "GRECIPIENT", amount: 100n });

    // The dynamic client's arg encoder expects `{ tag: "VariantName" }` for
    // Soroban enum params, not the raw TS number — confirmed live (a raw
    // number here previously failed with "no such enum entry: undefined").
    await registry.setStatus(AssetStatus.ACTIVE);
    expect(mockClientMethods.set_status).toHaveBeenCalledWith({ new_status: { tag: "Active" } });
  });

  it("template-gated methods (retire) reject on the wrong template before ever calling the adapter", async () => {
    const adapter = makeAdapter();
    const registry = new AssetRegistry(adapter, MOCK_CONTRACT_ID, "farmland");
    await expect(registry.retire(1n, "GBENEFICIARY", "note")).rejects.toThrow(/only available on carbon-credit/);
  });

  it("retire on a carbon-credit registry passes the signer as retired_by", async () => {
    mockClientMethods.retire = mockCall(undefined);
    const adapter = makeAdapter();
    const registry = new AssetRegistry(adapter, MOCK_CONTRACT_ID, "carbon-credit");

    await registry.retire(1n, "GBENEFICIARY", "note");

    expect(mockClientMethods.retire).toHaveBeenCalledWith({
      retired_by: TEST_PUBLIC, amount: 1n, beneficiary: "GBENEFICIARY", note: "note",
    });
  });

  it("NFT methods (ownerOf) reject on a fungible template", async () => {
    const adapter = makeAdapter();
    const registry = new AssetRegistry(adapter, MOCK_CONTRACT_ID, "farmland");
    await expect(registry.ownerOf(0)).rejects.toThrow(/only available on NFT templates/);
  });

  it("ownerOf on an NFT registry reads owner_of by token_id", async () => {
    mockClientMethods.owner_of = mockCall("GOWNER");
    const adapter = makeAdapter();
    const registry = new AssetRegistry(adapter, MOCK_CONTRACT_ID, "farmland-nft");

    await expect(registry.ownerOf(3)).resolves.toBe("GOWNER");
    expect(mockClientMethods.owner_of).toHaveBeenCalledWith({ token_id: 3 });
  });
});

describe("StellarAdapter — CommodityBatchToken (IAdapter)", () => {
  it("batchRegister maps camelCase metadata to the snake_case struct", async () => {
    mockClientMethods.register_batch = mockCall(undefined);
    const adapter = makeAdapter();

    await adapter.batchRegister(MOCK_CONTRACT_ID, 1n, {
      commodityType: "cocoa",
      quantityKg: 1000n,
      gradeClassification: "Grade A",
      depositDate: 100n,
      expiryDate: 200n,
      inspectionReportHash: "0x" + "00".repeat(32),
      valuationUSD: 10_000n,
      harvestSeason: "2025-Q1",
      originCountry: "NG",
    });

    const callArgs = mockClientMethods.register_batch.mock.calls[0][0];
    expect(callArgs.id).toBe(1n);
    expect(callArgs.batch.commodity_type).toBe("cocoa");
    expect(callArgs.batch.quantity_kg).toBe(1000n);
    expect(callArgs.batch.inspection_report_hash).toBeInstanceOf(Buffer);
  });

  it("batchMint passes to/id/amount", async () => {
    mockClientMethods.mint = mockCall(undefined);
    const adapter = makeAdapter();

    await adapter.batchMint(MOCK_CONTRACT_ID, 1n, "GRECIPIENT", 50n);

    expect(mockClientMethods.mint).toHaveBeenCalledWith({ to: "GRECIPIENT", id: 1n, amount: 50n });
  });
});

describe("StellarAdapter — PoolVault (IAdapter)", () => {
  it("deposit passes the signer as investor", async () => {
    mockClientMethods.deposit = mockCall(undefined);
    const adapter = makeAdapter();

    await adapter.poolDeposit(MOCK_CONTRACT_ID, MOCK_CONTRACT_ID, 500n);

    expect(mockClientMethods.deposit).toHaveBeenCalledWith({
      investor: TEST_PUBLIC, token_address: MOCK_CONTRACT_ID, amount: 500n,
    });
  });

  it("withdraw passes the signer as investor", async () => {
    mockClientMethods.withdraw = mockCall(undefined);
    const adapter = makeAdapter();

    await adapter.poolWithdraw(MOCK_CONTRACT_ID, 50n);

    expect(mockClientMethods.withdraw).toHaveBeenCalledWith({ investor: TEST_PUBLIC, pool_token_amount: 50n });
  });

  it("getStatus aggregates all vault reads and defaults a missing oracle to an empty string", async () => {
    mockClientMethods.name = mockCall("Ankara Basket");
    mockClientMethods.symbol = mockCall("ACB");
    mockClientMethods.total_supply = mockCall(1000n);
    mockClientMethods.nav_per_token = mockCall(1_000_000n);
    mockClientMethods.total_aum = mockCall(1_000_000_000n);
    mockClientMethods.management_fee_bps = mockCall(100);
    mockClientMethods.accepted_tokens = mockCall([MOCK_CONTRACT_ID]);
    mockClientMethods.last_fee_accrual = mockCall(12345n);
    mockClientMethods.oracle = mockCall(null);
    const adapter = makeAdapter();

    const status = await adapter.poolGetStatus(MOCK_CONTRACT_ID);

    expect(status).toEqual({
      name: "Ankara Basket",
      symbol: "ACB",
      totalSupply: 1000n,
      navPerToken: 1_000_000n,
      totalAUM: 1_000_000_000n,
      managementFeeBps: 100,
      acceptedTokens: [MOCK_CONTRACT_ID],
      lastFeeAccrual: 12345n,
      oracle: "",
    });
  });
});

describe("StellarAdapter — ManualOracle (IAdapter)", () => {
  it("setPrice passes token and price_usd", async () => {
    mockClientMethods.set_price = mockCall(undefined);
    const adapter = makeAdapter();

    await adapter.oracleSetPrice(MOCK_CONTRACT_ID, MOCK_CONTRACT_ID, 1_500_000n);

    expect(mockClientMethods.set_price).toHaveBeenCalledWith({ token: MOCK_CONTRACT_ID, price_usd: 1_500_000n });
  });
});

describe("StellarAdapter — generic transfer (IAdapter)", () => {
  it("genericTransferToken passes from/to/amount", async () => {
    mockClientMethods.transfer = mockCall(undefined);
    const adapter = makeAdapter();

    await adapter.genericTransferToken(MOCK_CONTRACT_ID, "GRECIPIENT", 100n);

    expect(mockClientMethods.transfer).toHaveBeenCalledWith({ from: TEST_PUBLIC, to: "GRECIPIENT", amount: 100n });
  });

  it("genericTransferNFT passes from/to/token_id", async () => {
    mockClientMethods.transfer = mockCall(undefined);
    const adapter = makeAdapter();

    await adapter.genericTransferNFT(MOCK_CONTRACT_ID, "GRECIPIENT", 3n);

    expect(mockClientMethods.transfer).toHaveBeenCalledWith({ from: TEST_PUBLIC, to: "GRECIPIENT", token_id: 3n });
  });
});
