import { describe, it, expect, vi, beforeEach } from "vitest";

const contractMocks: Record<string, any> = {};

vi.mock("ethers", async () => {
  const actual = await vi.importActual<typeof import("ethers")>("ethers");
  return {
    ...actual,
    ethers: {
      ...actual.ethers,
      JsonRpcProvider: vi.fn().mockImplementation(() => ({ _isMockProvider: true })),
      Wallet: vi.fn().mockImplementation((_key: string, provider: unknown) => ({
        address: "0xWalletAddress000000000000000000000000000",
        provider,
      })),
      Contract: vi.fn().mockImplementation((address: string) => contractMocks[address] ?? {}),
    },
  };
});

// A Stellar adapter stand-in: every IAdapter method the tools call is a spy.
const stellarAdapter: Record<string, any> = {};

vi.mock("@ankarachain/sdk", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@ankarachain/sdk");
  return {
    ...actual,
    TokenFactory: vi.fn(),
    EVMAdapter: vi.fn(),
    EscrowManager: vi.fn(),
    StellarAdapter: vi.fn().mockImplementation(() => stellarAdapter),
  };
});

import { TOOLS, HANDLERS, callTool } from "./index";
import { TokenFactory, EscrowManager } from "@ankarachain/sdk";

describe("TOOLS", () => {
  it("every tool has a name, description, and object inputSchema", () => {
    for (const tool of TOOLS) {
      expect(typeof tool.name).toBe("string");
      expect(tool.name.length).toBeGreaterThan(0);
      expect(typeof tool.description).toBe("string");
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("has unique tool names", () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every required field is declared in properties", () => {
    for (const tool of TOOLS) {
      const required = (tool.inputSchema as any).required ?? [];
      const properties = Object.keys((tool.inputSchema as any).properties ?? {});
      for (const field of required) {
        expect(properties).toContain(field);
      }
    }
  });

  it("includes all 8 escrow tools", () => {
    const names = TOOLS.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "deploy_escrow",
        "fund_escrow",
        "mark_milestone_delivered",
        "approve_milestone",
        "raise_dispute",
        "resolve_dispute",
        "claim_timelock_release",
        "get_escrow_status",
      ])
    );
  });

  it("includes deploy_pool_vault alongside deploy_batch_token", () => {
    const names = TOOLS.map((t) => t.name);
    expect(names).toContain("deploy_batch_token");
    expect(names).toContain("deploy_pool_vault");
  });

  it("includes all 8 ramp tools", () => {
    const names = TOOLS.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "deploy_ramp_settlement",
        "get_ramp_quote",
        "initiate_onramp",
        "record_onramp_settlement",
        "initiate_offramp",
        "confirm_offramp_settlement",
        "refund_offramp",
        "get_ramp_status",
      ])
    );
  });
});

describe("TOOLS ↔ HANDLERS", () => {
  it("every declared tool has a handler and vice versa", () => {
    expect(new Set(TOOLS.map((t) => t.name))).toEqual(new Set(Object.keys(HANDLERS)));
  });

  it("every chain-touching tool accepts a network argument", () => {
    const offChain = new Set(["get_template_fields", "get_ramp_quote", "initiate_onramp", "query_indexer_events"]);
    for (const tool of TOOLS) {
      if (offChain.has(tool.name)) continue;
      expect(Object.keys((tool.inputSchema as any).properties)).toContain("network");
    }
  });
});

describe("callTool dispatch", () => {
  it("returns an error result for an unknown tool name", async () => {
    const result: any = await callTool("not_a_real_tool", {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Unknown tool/);
  });

  it("wraps handler exceptions in an error result instead of throwing", async () => {
    // get_token_status will throw because the mocked Contract has no `name`/`symbol` methods
    const result: any = await callTool("get_token_status", {
      contractAddress: "0xDeadBeef00000000000000000000000000000000",
      rpcUrl: "http://localhost:8545",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Error:/);
  });
});

describe("get_token_status handler", () => {
  beforeEach(() => {
    for (const key of Object.keys(contractMocks)) delete contractMocks[key];
  });

  it("maps the on-chain status enum to a human-readable label", async () => {
    const address = "0xTokenAddress0000000000000000000000000000";
    contractMocks[address] = {
      name: vi.fn().mockResolvedValue("Kano Farmland Token"),
      symbol: vi.fn().mockResolvedValue("KFT"),
      totalSupply: vi.fn().mockResolvedValue(1_000_000000000000000000n),
      status: vi.fn().mockResolvedValue(1n), // ACTIVE
    };

    const result: any = await callTool("get_token_status", {
      contractAddress: address,
      rpcUrl: "http://localhost:8545",
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.name).toBe("Kano Farmland Token");
    expect(parsed.symbol).toBe("KFT");
    expect(parsed.statusLabel).toBe("ACTIVE");
  });
});

describe("list_deployments handler", () => {
  beforeEach(() => {
    for (const key of Object.keys(contractMocks)) delete contractMocks[key];
  });

  it("returns the deployer's token list and count", async () => {
    const factoryAddress = "0xFactoryAddress00000000000000000000000000";
    contractMocks[factoryAddress] = {
      getDeployerTokens: vi.fn().mockResolvedValue(["0xAAA", "0xBBB"]),
    };

    const result = await callTool("list_deployments", {
      factoryAddress,
      deployerAddress: "0xDeployerAddress0000000000000000000000000",
      rpcUrl: "http://localhost:8545",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.tokens).toEqual(["0xAAA", "0xBBB"]);
    expect(parsed.count).toBe(2);
  });
});

describe("get_ramp_quote handler", () => {
  it("computes a quote via the real ManualRampProvider (no chain call needed)", async () => {
    const result: any = await callTool("get_ramp_quote", {
      direction: "on-ramp",
      fiatCurrency: "NGN",
      tokenSymbol: "mUSD",
      countryCode: "NG",
      fiatAmount: "1500",
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.direction).toBe("on-ramp");
    expect(parsed.fiatAmount).toBe("1500.00");
    expect(parseFloat(parsed.tokenAmount)).toBeGreaterThan(0);
  });
});

describe("get_ramp_status handler", () => {
  beforeEach(() => {
    for (const key of Object.keys(contractMocks)) delete contractMocks[key];
  });

  it("reports null off-ramp/on-ramp when nothing was recorded for the reference", async () => {
    const settlementAddress = "0xSettlement000000000000000000000000000000";
    contractMocks[settlementAddress] = {
      treasury: vi.fn().mockResolvedValue("0xTreasury00000000000000000000000000000000"),
      getOffRamp: vi.fn().mockResolvedValue({ depositor: "0x0", token: "0x0", amount: 0n, status: 0n }),
      getOnRamp: vi.fn().mockResolvedValue({ recipient: "0x0", token: "0x0", amount: 0n, status: 0n }),
    };

    const result: any = await callTool("get_ramp_status", {
      settlementAddress,
      reference: "some-reference",
      rpcUrl: "http://localhost:8545",
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.offRamp).toBeNull();
    expect(parsed.onRamp).toBeNull();
  });

  it("reports a SETTLED off-ramp deposit", async () => {
    const settlementAddress = "0xSettlement000000000000000000000000000001";
    contractMocks[settlementAddress] = {
      treasury: vi.fn().mockResolvedValue("0xTreasury00000000000000000000000000000000"),
      getOffRamp: vi.fn().mockResolvedValue({
        depositor: "0xDepositor0000000000000000000000000000000",
        token: "0xToken0000000000000000000000000000000000",
        amount: 100_000000000000000000n,
        status: 2n, // SETTLED
      }),
      getOnRamp: vi.fn().mockResolvedValue({ recipient: "0x0", token: "0x0", amount: 0n, status: 0n }),
    };

    const result: any = await callTool("get_ramp_status", {
      settlementAddress,
      reference: "some-reference",
      rpcUrl: "http://localhost:8545",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.offRamp.status).toBe("SETTLED");
    expect(parsed.offRamp.amount).toBe("100.0");
  });
});

// ─── Stellar + full template coverage ────────────────────────────────────────

const STELLAR = { network: "stellar-testnet", stellarSecretKey: "SSECRET" };
const EVM = { rpcUrl: "http://localhost:8545", privateKey: "0x" + "11".repeat(32) };

function parse(result: any) {
  expect(result.isError, result.content?.[0]?.text).toBeUndefined();
  return JSON.parse(result.content[0].text);
}

function resetStellar() {
  for (const k of Object.keys(stellarAdapter)) delete stellarAdapter[k];
  stellarAdapter.getSignerAddress = vi.fn().mockResolvedValue("GSIGNER");
}

describe("get_template_fields", () => {
  it("lists fields for all six fungible templates", async () => {
    const all = parse(await callTool("get_template_fields", {}));
    expect(all.map((t: any) => t.template)).toEqual(["farmland", "commodity", "real-estate", "invoice", "carbon-credit", "mining-rights"]);
    const invoice = parse(await callTool("get_template_fields", { template: "invoice" }));
    expect(invoice.fields.map((f: any) => f.name)).toContain("faceValueUSD");
  });
});

describe("deploy_token — all six templates", () => {
  const deployCalls: Array<{ method: string; opts: any; config: any }> = [];

  beforeEach(() => {
    deployCalls.length = 0;
    resetStellar();
    (TokenFactory as any).mockImplementation((config: any) => new Proxy({}, {
      get: (_t, method: string) => async (opts: any) => {
        deployCalls.push({ method, opts, config });
        return { tokenAddress: "CTOKEN", txHash: "0xhash" };
      },
    }));
  });

  const cases: Array<[string, string, Record<string, unknown>, (m: any) => void]> = [
    ["farmland", "deployFarmland", { areaSqMeters: 42 }, (m) => {
      expect(m.areaSqMeters).toBe(42n);
      expect(m.soilType).toBe("loam");
      expect(m.valuationUSD).toBe(50_000n * 10n ** 18n);
    }],
    ["commodity", "deployCommodity", { commodityType: "cocoa", expiryDays: 10 }, (m) => {
      expect(m.commodityType).toBe("cocoa");
      expect(m.expiryDate - m.depositDate).toBe(10n * 86_400n);
    }],
    ["real-estate", "deployRealEstate", { propertyType: "Commercial" }, (m) => {
      expect(m.propertyType).toBe("Commercial");
      expect(m.rentalYieldBps).toBe(600n);
    }],
    ["invoice", "deployInvoice", { faceValueUSD: "2500.5" }, (m) => {
      expect(m.faceValueUSD).toBe(2_500_500_000_000_000_000_000n);
      expect(m.dueDate - m.issuanceDate).toBe(90n * 86_400n);
    }],
    ["carbon-credit", "deployCarbonCredit", { quantityCO2e: 3 }, (m) => {
      expect(m.quantityCO2e).toBe(3n * 10n ** 18n);
      expect(m.creditType).toBe("VCS");
    }],
    ["mining-rights", "deployMiningRights", { mineralType: "Lithium", royaltyRateBps: 450 }, (m) => {
      expect(m.mineralType).toBe("Lithium");
      expect(m.royaltyRateBps).toBe(450n);
    }],
  ];

  for (const [template, method, metadata, check] of cases) {
    it(`deploys ${template} on EVM with real metadata`, async () => {
      const out = parse(await callTool("deploy_token", {
        template, name: "T", symbol: "TKN", assetId: "A-1", countryCode: "NG", factoryAddress: "0xFactory", metadata, ...EVM,
      }));
      expect(out.contractAddress).toBe("CTOKEN");
      expect(deployCalls[0].method).toBe(method);
      expect(deployCalls[0].config.network).toBe("localhost");
      check(deployCalls[0].opts.metadata);
    });

    it(`deploys ${template} on Stellar`, async () => {
      parse(await callTool("deploy_token", {
        template, name: "T", symbol: "TKN", assetId: "A-1", countryCode: "NG", factoryAddress: "CFACTORY", metadata, ...STELLAR,
      }));
      expect(deployCalls[0].method).toBe(method);
      expect(deployCalls[0].config).toMatchObject({ network: "stellar-testnet", stellarSecretKey: "SSECRET", factoryAddress: "CFACTORY" });
      expect(deployCalls[0].opts.admin).toBe("GSIGNER");
      check(deployCalls[0].opts.metadata);
    });
  }

  it("defaults real-estate developerAddress to the signer on Stellar", async () => {
    parse(await callTool("deploy_token", {
      template: "real-estate", name: "T", symbol: "T", assetId: "A", countryCode: "NG", factoryAddress: "CF", ...STELLAR,
    }));
    expect(deployCalls[0].opts.metadata.developerAddress).toBe("GSIGNER");
  });

  it("rejects unknown fields, bad choices, and missing keys before deploying", async () => {
    const base = { name: "T", symbol: "T", assetId: "A", countryCode: "NG", factoryAddress: "CF", ...STELLAR };
    const unknownField: any = await callTool("deploy_token", { ...base, template: "farmland", metadata: { color: "green" } });
    expect(unknownField.content[0].text).toMatch(/Unknown farmland metadata field\(s\): color/);
    const badChoice: any = await callTool("deploy_token", { ...base, template: "mining-rights", metadata: { mineralType: "Unobtainium" } });
    expect(badChoice.content[0].text).toMatch(/mineralType must be one of/);
    const noKey: any = await callTool("deploy_token", { ...base, template: "farmland", stellarSecretKey: undefined });
    expect(noKey.content[0].text).toMatch(/stellarSecretKey is required/);
    const badNetwork: any = await callTool("deploy_token", { ...base, template: "farmland", network: "solana" });
    expect(badNetwork.content[0].text).toMatch(/Unknown network/);
    expect(deployCalls).toHaveLength(0);
  });
});

describe("Stellar code paths for management tools", () => {
  beforeEach(resetStellar);

  it("mint / transfer / balance / pool / oracle route through the Stellar adapter", async () => {
    stellarAdapter.mintTokens = vi.fn().mockResolvedValue("tx-mint");
    stellarAdapter.genericTransferToken = vi.fn().mockResolvedValue("tx-transfer");
    stellarAdapter.getBalance2 = vi.fn().mockResolvedValue(5n * 10n ** 18n);
    stellarAdapter.poolDeposit = vi.fn().mockResolvedValue("tx-dep");
    stellarAdapter.poolWithdraw = vi.fn().mockResolvedValue("tx-wd");
    stellarAdapter.oracleSetPrice = vi.fn().mockResolvedValue("tx-price");

    expect(parse(await callTool("mint_tokens", { contractAddress: "CT", to: "GA", amount: "10", ...STELLAR })).txHash).toBe("tx-mint");
    expect(stellarAdapter.mintTokens).toHaveBeenCalledWith("CT", "GA", 10n * 10n ** 18n);
    parse(await callTool("transfer_tokens", { contractAddress: "CT", to: "GB", amount: "1", ...STELLAR }));
    expect(stellarAdapter.genericTransferToken).toHaveBeenCalledWith("CT", "GB", 10n ** 18n);
    expect(parse(await callTool("get_token_balance", { contractAddress: "CT", holder: "GA", network: "stellar-testnet" })).balance).toBe("5.0");
    parse(await callTool("pool_deposit", { vaultAddress: "CV", token: "CT", amount: "2", ...STELLAR }));
    expect(stellarAdapter.poolDeposit).toHaveBeenCalledWith("CV", "CT", 2n * 10n ** 18n);
    parse(await callTool("pool_withdraw", { vaultAddress: "CV", poolTokenAmount: "1", ...STELLAR }));
    parse(await callTool("oracle_set_price", { oracleAddress: "CO", token: "CT", priceUSD: "1.5", ...STELLAR }));
    expect(stellarAdapter.oracleSetPrice).toHaveBeenCalledWith("CO", "CT", 1_500_000_000_000_000_000n);
  });

  it("asset_action covers template-specific actions (retire, declare_royalty, mark_defaulted)", async () => {
    stellarAdapter.assetRetire = vi.fn().mockResolvedValue("tx-retire");
    stellarAdapter.assetDeclareRoyalty = vi.fn().mockResolvedValue("tx-royalty");
    stellarAdapter.assetMarkDefaulted = vi.fn().mockResolvedValue("tx-default");
    const retire = parse(await callTool("asset_action", {
      contractAddress: "CC", template: "carbon-credit", action: "retire",
      params: { amount: "3", beneficiary: "Acme", note: "FY26" }, ...STELLAR,
    }));
    expect(retire.txHash).toBe("tx-retire");
    expect(stellarAdapter.assetRetire).toHaveBeenCalledWith("CC", 3n * 10n ** 18n, "Acme", "FY26");
    parse(await callTool("asset_action", {
      contractAddress: "CM", template: "mining-rights", action: "declare_royalty", params: { extractionValueUSD: "1000" }, ...STELLAR,
    }));
    parse(await callTool("asset_action", {
      contractAddress: "CI", template: "invoice", action: "mark_defaulted", params: { reason: "late" }, ...STELLAR,
    }));
    expect(stellarAdapter.assetMarkDefaulted).toHaveBeenCalledWith("CI", "late");

    const wrongTemplate: any = await callTool("asset_action", {
      contractAddress: "CF", template: "farmland", action: "retire", params: { amount: "1", beneficiary: "x" }, ...STELLAR,
    });
    expect(wrongTemplate.content[0].text).toMatch(/only available on carbon-credit/);
    const missingParam: any = await callTool("asset_action", {
      contractAddress: "CI", template: "invoice", action: "mark_defaulted", ...STELLAR,
    });
    expect(missingParam.content[0].text).toMatch(/requires params.reason/);
  });

  it("get_asset_details includes template-specific state and serializes bigints", async () => {
    Object.assign(stellarAdapter, {
      assetGetName: vi.fn().mockResolvedValue("Cross River REDD+"),
      assetGetSymbol: vi.fn().mockResolvedValue("CRC"),
      assetGetTotalSupply: vi.fn().mockResolvedValue(7n * 10n ** 18n),
      assetGetStatus: vi.fn().mockResolvedValue(1),
      assetGetCountryCode: vi.fn().mockResolvedValue("NG"),
      assetGetIdentityVerifier: vi.fn().mockResolvedValue(""),
      assetGetVersion: vi.fn().mockResolvedValue(2),
      assetGetMetadata: vi.fn().mockResolvedValue({ vintageYear: 2025n }),
      assetGetTotalRetired: vi.fn().mockResolvedValue(10n ** 18n),
      assetGetTotalRetirements: vi.fn().mockResolvedValue(1),
    });
    const d = parse(await callTool("get_asset_details", { contractAddress: "CC", template: "carbon-credit", network: "stellar-testnet" }));
    expect(d).toMatchObject({ statusLabel: "ACTIVE", totalSupply: "7.0", totalRetired: "1.0", totalRetirements: 1, metadata: { vintageYear: "2025" } });
  });

  it("collateral-vault tools work on Stellar and refuse EVM", async () => {
    stellarAdapter.vaultOpenLoan = vi.fn().mockResolvedValue({ loanId: 3, txHash: "tx-open" });
    stellarAdapter.vaultGetLoan = vi.fn().mockResolvedValue({ borrower: "GB", borrowedAmount: 600n, status: 0 });
    stellarAdapter.vaultCurrentLtvBps = vi.fn().mockResolvedValue(6000);
    stellarAdapter.vaultIsLiquidatable = vi.fn().mockResolvedValue(false);
    const open = parse(await callTool("vault_open_loan", {
      vaultAddress: "CV", collateralToken: "CF", collateralAmount: "1000", borrowAmount: "600", ...STELLAR,
    }));
    expect(open).toEqual({ loanId: 3, txHash: "tx-open" });
    expect(stellarAdapter.vaultOpenLoan).toHaveBeenCalledWith("CV", "CF", 1000n, 600n);
    const loan = parse(await callTool("get_loan", { vaultAddress: "CV", loanId: 3, network: "stellar-testnet" }));
    expect(loan).toMatchObject({ loanId: 3, borrowedAmount: "600", currentLtvBps: 6000, liquidatable: false });

    const evm: any = await callTool("vault_open_loan", { vaultAddress: "0xV", collateralToken: "0xC", collateralAmount: "1", borrowAmount: "1", ...EVM });
    expect(evm.content[0].text).toMatch(/Stellar-only/);
  });

  it("status / listing / ramp status have Stellar paths", async () => {
    Object.assign(stellarAdapter, {
      genericGetTokenMetadata: vi.fn().mockResolvedValue({ name: "Farm", symbol: "FRM", decimals: 18 }),
      assetGetTotalSupply: vi.fn().mockResolvedValue(10n ** 18n),
      assetGetStatus: vi.fn().mockResolvedValue(2),
      getDeployerTokens: vi.fn().mockResolvedValue(["CA", "CB"]),
      rampGetOffRampDeposit: vi.fn().mockResolvedValue({ depositor: "GD", token: "CT", amount: 10n ** 18n, status: 2 }),
      rampGetOnRampRecord: vi.fn().mockResolvedValue({ recipient: "", token: "", amount: 0n, status: 0 }),
    });
    expect(parse(await callTool("get_token_status", { contractAddress: "CT", network: "stellar" })).statusLabel).toBe("SUSPENDED");
    expect(parse(await callTool("list_deployments", { factoryAddress: "CF", deployerAddress: "GD", network: "stellar" })).count).toBe(2);
    const ramp = parse(await callTool("get_ramp_status", { settlementAddress: "CS", reference: "r", network: "stellar" }));
    expect(ramp.offRamp).toMatchObject({ status: "SETTLED", amount: "1.0" });
    expect(ramp.onRamp).toBeNull();
  });
});

describe("fund_escrow", () => {
  it("funds every unfunded milestone when no id is given (Stellar: no approve step)", async () => {
    resetStellar();
    const fund = vi.fn().mockResolvedValueOnce("tx-1").mockResolvedValueOnce("tx-2");
    (EscrowManager as any).mockImplementation(() => ({
      getAllMilestones: vi.fn().mockResolvedValue([
        { amount: 10n ** 18n, funded: true, status: 0, deliveredAt: 0n },
        { amount: 2n * 10n ** 18n, funded: false, status: 0, deliveredAt: 0n },
        { amount: 3n * 10n ** 18n, funded: false, status: 0, deliveredAt: 0n },
      ]),
      fund,
    }));
    const out = parse(await callTool("fund_escrow", { escrowAddress: "CE", ...STELLAR }));
    expect(out).toEqual({ funded: [1, 2], fundedAmount: "5.0", txHashes: ["tx-1", "tx-2"] });
    expect(fund).toHaveBeenCalledWith(1);
    expect(fund).toHaveBeenCalledWith(2);
  });
});

describe("commodity batch tools", () => {
  it("register + mint route through the adapter", async () => {
    resetStellar();
    stellarAdapter.batchRegister = vi.fn().mockResolvedValue("tx-reg");
    stellarAdapter.batchMint = vi.fn().mockResolvedValue("tx-mint");
    parse(await callTool("batch_register", {
      contractAddress: "CB", batchId: "7", commodityType: "cocoa", quantityKg: "1000", gradeClassification: "A",
      harvestSeason: "2026", originCountry: "GH", valuationUSD: "5000", ...STELLAR,
    }));
    const meta = stellarAdapter.batchRegister.mock.calls[0][2];
    expect(meta.valuationUSD).toBe(5000n * 10n ** 18n);
    expect(meta.expiryDate - meta.depositDate).toBe(365n * 86_400n);
    parse(await callTool("batch_mint", { contractAddress: "CB", batchId: "7", to: "GA", amount: "25", ...STELLAR }));
    expect(stellarAdapter.batchMint).toHaveBeenCalledWith("CB", 7n, "GA", 25n);
  });
});
