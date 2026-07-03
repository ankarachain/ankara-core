import { describe, it, expect } from "vitest";
import { ethers } from "ethers";
import {
  TokenFactory,
  AssetRegistry,
  EscrowManager,
  EVMAdapter,
  AssetStatus,
  InvoiceStatus,
  MilestoneStatus,
} from "../index";
import type { AssetTemplate, NFTAssetTemplate } from "../types";

// Shared helpers — no real network calls made at instantiation time
const MOCK_ADDR = "0x0000000000000000000000000000000000000001";

function makeAdapter(): EVMAdapter {
  const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545", 31337);
  return new EVMAdapter("localhost", provider);
}

function makeFactory(): TokenFactory {
  return new TokenFactory({ network: "localhost", factoryAddress: MOCK_ADDR });
}

function makeRegistry(template: AssetTemplate): AssetRegistry {
  return new AssetRegistry(makeAdapter(), MOCK_ADDR, template);
}

function makeNFTRegistry(template: NFTAssetTemplate): AssetRegistry {
  return new AssetRegistry(makeAdapter(), MOCK_ADDR, template);
}

function makeEscrowManager(): EscrowManager {
  return new EscrowManager(makeAdapter(), MOCK_ADDR);
}

// ─── Enum exports ─────────────────────────────────────────────────────────────

describe("AssetStatus enum", () => {
  it("has correct numeric values", () => {
    expect(AssetStatus.DRAFT).toBe(0);
    expect(AssetStatus.ACTIVE).toBe(1);
    expect(AssetStatus.SUSPENDED).toBe(2);
    expect(AssetStatus.REDEEMED).toBe(3);
    expect(AssetStatus.EXPIRED).toBe(4);
  });
});

describe("InvoiceStatus enum", () => {
  it("has correct numeric values matching InvoiceToken.sol", () => {
    expect(InvoiceStatus.PENDING).toBe(0);
    expect(InvoiceStatus.FUNDED).toBe(1);
    expect(InvoiceStatus.REPAID).toBe(2);
    expect(InvoiceStatus.DEFAULTED).toBe(3);
  });
});

describe("MilestoneStatus enum", () => {
  it("has correct numeric values matching MilestoneEscrow.sol", () => {
    expect(MilestoneStatus.PENDING).toBe(0);
    expect(MilestoneStatus.DELIVERED).toBe(1);
    expect(MilestoneStatus.DISPUTED).toBe(2);
    expect(MilestoneStatus.RELEASED).toBe(3);
    expect(MilestoneStatus.REFUNDED).toBe(4);
  });
});

// ─── TokenFactory ─────────────────────────────────────────────────────────────

describe("TokenFactory", () => {
  it("instantiates without a signer (read-only config)", () => {
    expect(() => makeFactory()).not.toThrow();
  });

  it("exposes the network getter", () => {
    expect(makeFactory().network).toBe("localhost");
  });

  it("exposes all 6 deploy methods", () => {
    const f = makeFactory();
    expect(typeof f.deployFarmland).toBe("function");
    expect(typeof f.deployCommodity).toBe("function");
    expect(typeof f.deployRealEstate).toBe("function");
    expect(typeof f.deployInvoice).toBe("function");
    expect(typeof f.deployCarbonCredit).toBe("function");
    expect(typeof f.deployMiningRights).toBe("function");
  });

  it("exposes query methods", () => {
    const f = makeFactory();
    expect(typeof f.getDeployedTokens).toBe("function");
    expect(typeof f.totalDeployed).toBe("function");
    expect(typeof f.getBalance).toBe("function");
  });

  it("exposes the adapter escape hatch", () => {
    const f = makeFactory();
    expect(f.adapter).toBeInstanceOf(EVMAdapter);
  });

  it("accepts all supported networks without throwing", () => {
    const networks = ["polygon-amoy", "polygon", "ethereum", "bnb", "celo", "localhost"] as const;
    for (const n of networks) {
      expect(() => new TokenFactory({ network: n, factoryAddress: MOCK_ADDR })).not.toThrow();
    }
  });

  it("exposes NFT deploy methods", () => {
    const f = makeFactory();
    expect(typeof f.deployFarmlandNFT).toBe("function");
    expect(typeof f.deployRealEstateNFT).toBe("function");
    expect(typeof f.deployMiningRightsNFT).toBe("function");
    expect(typeof f.deployCommodityVaultNFT).toBe("function");
  });

  it("exposes NFT query methods", () => {
    const f = makeFactory();
    expect(typeof f.getDeployedNFTs).toBe("function");
    expect(typeof f.totalDeployedNFTs).toBe("function");
  });

  it("exposes escrow deploy and query methods", () => {
    const f = makeFactory();
    expect(typeof f.deployEscrow).toBe("function");
    expect(typeof f.getDeployedEscrows).toBe("function");
    expect(typeof f.totalDeployedEscrows).toBe("function");
  });
});

// ─── AssetRegistry ────────────────────────────────────────────────────────────

const ALL_TEMPLATES: AssetTemplate[] = [
  "farmland",
  "commodity",
  "real-estate",
  "invoice",
  "carbon-credit",
  "mining-rights",
];

const ALL_NFT_TEMPLATES: NFTAssetTemplate[] = [
  "farmland-nft",
  "real-estate-nft",
  "mining-rights-nft",
  "commodity-vault-nft",
];

describe("AssetRegistry", () => {
  it("instantiates for all 6 asset templates", () => {
    for (const t of ALL_TEMPLATES) {
      expect(() => makeRegistry(t), `should not throw for ${t}`).not.toThrow();
    }
  });

  it("exposes address and template getters", () => {
    const r = makeRegistry("farmland");
    expect(r.address).toBe(MOCK_ADDR);
    expect(r.template).toBe("farmland");
  });

  it("exposes generic read methods on all templates", () => {
    const methods = [
      "getName", "getSymbol", "getTotalSupply", "getBalanceOf",
      "getStatus", "getCountryCode", "getIdentityVerifier",
      "getVersion", "getMetadata",
    ];
    for (const t of ALL_TEMPLATES) {
      const r = makeRegistry(t);
      for (const m of methods) {
        expect(typeof (r as any)[m], `${t}.${m}`).toBe("function");
      }
    }
  });

  it("exposes generic write methods on all templates", () => {
    const methods = ["setStatus", "setIdentityVerifier", "mint", "pause", "unpause"];
    for (const t of ALL_TEMPLATES) {
      const r = makeRegistry(t);
      for (const m of methods) {
        expect(typeof (r as any)[m], `${t}.${m}`).toBe("function");
      }
    }
  });

  it("exposes updateValuation on farmland and real-estate", () => {
    expect(typeof makeRegistry("farmland").updateValuation).toBe("function");
    expect(typeof makeRegistry("real-estate").updateValuation).toBe("function");
  });

  it("throws updateValuation for non-applicable templates", async () => {
    const r = makeRegistry("invoice");
    await expect(r.updateValuation(1000n)).rejects.toThrow();
  });

  it("exposes invoice-specific methods for invoice template", () => {
    const r = makeRegistry("invoice");
    expect(typeof r.getInvoiceStatus).toBe("function");
    expect(typeof r.markFunded).toBe("function");
    expect(typeof r.markRepaid).toBe("function");
    expect(typeof r.markDefaulted).toBe("function");
    expect(typeof r.isOverdue).toBe("function");
  });

  it("throws invoice methods on non-invoice templates", async () => {
    const r = makeRegistry("farmland");
    await expect(r.getInvoiceStatus()).rejects.toThrow();
    await expect(r.markFunded()).rejects.toThrow();
  });

  it("exposes carbon-credit-specific methods", () => {
    const r = makeRegistry("carbon-credit");
    expect(typeof r.retire).toBe("function");
    expect(typeof r.getTotalRetired).toBe("function");
    expect(typeof r.getTotalRetirements).toBe("function");
    expect(typeof r.getRetirement).toBe("function");
  });

  it("throws carbon methods on non-carbon templates", async () => {
    const r = makeRegistry("farmland");
    await expect(r.retire(1n, "x", "y")).rejects.toThrow();
    await expect(r.getTotalRetired()).rejects.toThrow();
  });

  it("exposes real-estate-specific methods", () => {
    const r = makeRegistry("real-estate");
    expect(typeof r.updateOccupancyStatus).toBe("function");
    expect(typeof r.declareRentalDistribution).toBe("function");
  });

  it("exposes commodity-specific methods", () => {
    const r = makeRegistry("commodity");
    expect(typeof r.isExpired).toBe("function");
    expect(typeof r.markExpired).toBe("function");
  });

  it("exposes mining-rights-specific methods", () => {
    const r = makeRegistry("mining-rights");
    expect(typeof r.isLicenseExpired).toBe("function");
    expect(typeof r.renewLicense).toBe("function");
    expect(typeof r.markLicenseExpired).toBe("function");
    expect(typeof r.declareRoyalty).toBe("function");
  });
});

// ─── AssetRegistry — NFT templates ────────────────────────────────────────────

describe("AssetRegistry (NFT templates)", () => {
  it("instantiates for all 4 NFT templates without throwing", () => {
    for (const t of ALL_NFT_TEMPLATES) {
      expect(() => makeNFTRegistry(t), `should not throw for ${t}`).not.toThrow();
    }
  });

  it("exposes address and template getters for NFT templates", () => {
    const r = makeNFTRegistry("farmland-nft");
    expect(r.address).toBe(MOCK_ADDR);
    expect(r.template).toBe("farmland-nft");
  });

  it("exposes NFT-specific methods on all NFT templates", () => {
    const methods = ["getTokenMetadata", "getTokenVersion", "ownerOf", "linkToERC20"];
    for (const t of ALL_NFT_TEMPLATES) {
      const r = makeNFTRegistry(t);
      for (const m of methods) {
        expect(typeof (r as any)[m], `${t}.${m}`).toBe("function");
      }
    }
  });

  it("throws NFT methods on ERC-20 templates", async () => {
    const r = makeRegistry("farmland");
    await expect((r as any).getTokenMetadata(1)).rejects.toThrow();
    await expect((r as any).ownerOf(1)).rejects.toThrow();
  });

  it("exposes generic reads on NFT templates (status, assetId, countryCode)", () => {
    const genericMethods = ["getStatus", "getCountryCode", "getIdentityVerifier", "getVersion"];
    for (const t of ALL_NFT_TEMPLATES) {
      const r = makeNFTRegistry(t);
      for (const m of genericMethods) {
        expect(typeof (r as any)[m], `${t}.${m}`).toBe("function");
      }
    }
  });
});

// ─── EscrowManager ────────────────────────────────────────────────────────────

describe("EscrowManager", () => {
  it("instantiates without throwing", () => {
    expect(() => makeEscrowManager()).not.toThrow();
  });

  it("exposes the address getter", () => {
    expect(makeEscrowManager().address).toBe(MOCK_ADDR);
  });

  it("exposes read methods", () => {
    const e = makeEscrowManager();
    const methods = [
      "getPayer", "getPayee", "getArbiter", "getToken", "getTotalAmount",
      "isFunded", "isCancelled", "milestoneCount", "getMilestone",
      "getAllMilestones", "remainingBalance",
    ];
    for (const m of methods) {
      expect(typeof (e as any)[m], m).toBe("function");
    }
  });

  it("exposes lifecycle write methods", () => {
    const e = makeEscrowManager();
    const methods = [
      "fund", "markDelivered", "approveMilestone", "raiseDispute",
      "resolveDispute", "claimTimelockRelease", "voteCancel",
    ];
    for (const m of methods) {
      expect(typeof (e as any)[m], m).toBe("function");
    }
  });

  it("exposes admin methods", () => {
    const e = makeEscrowManager();
    expect(typeof e.setArbiter).toBe("function");
    expect(typeof e.setIdentityVerifier).toBe("function");
    expect(typeof e.pause).toBe("function");
    expect(typeof e.unpause).toBe("function");
  });
});
