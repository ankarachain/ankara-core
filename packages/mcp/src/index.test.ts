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

vi.mock("@ankarachain/sdk", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@ankarachain/sdk");
  return {
    ...actual,
    TokenFactory: vi.fn(),
    EVMAdapter: vi.fn(),
    EscrowManager: vi.fn(),
  };
});

import { TOOLS, callTool } from "./index";

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
