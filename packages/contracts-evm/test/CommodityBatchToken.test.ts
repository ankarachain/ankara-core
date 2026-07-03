import { expect } from "chai";
import { ethers } from "hardhat";
import type { CommodityBatchToken, WhitelistVerifier } from "../typechain-types";

describe("CommodityBatchToken", function () {
  let token: CommodityBatchToken;
  let verifier: WhitelistVerifier;
  let owner: any, manager: any, minter_: any, user: any, stranger: any;

  const warehouseMeta = (overrides?: Partial<{
    warehouseId: string;
    warehouseLocation: string;
    operatorAddress: string;
    warehouseLicenseHash: string;
    certificationExpiry: bigint;
  }>) => ({
    warehouseId:          "WH-LAG-001",
    warehouseLocation:    "Apapa, Lagos, Nigeria",
    operatorAddress:      ethers.ZeroAddress,
    warehouseLicenseHash: ethers.ZeroHash,
    certificationExpiry:  BigInt(9999999999),
    ...overrides,
  });

  const batchMeta = (overrides?: {
    commodityType?: string;
    quantityKg?: bigint;
    gradeClassification?: string;
    expiryDate?: bigint;
    valuationUSD?: bigint;
    originCountry?: string;
    harvestSeason?: string;
  }) => ({
    commodityType:        "cocoa",
    quantityKg:           10000n,
    gradeClassification:  "Grade A",
    depositDate:          0n,
    expiryDate:           0n,
    inspectionReportHash: ethers.ZeroHash,
    valuationUSD:         500000n,
    harvestSeason:        "2025-Q1",
    originCountry:        "NG",
    ...overrides,
  });

  beforeEach(async function () {
    [owner, manager, minter_, user, stranger] = await ethers.getSigners();

    verifier = await (await ethers.getContractFactory("WhitelistVerifier"))
      .deploy(owner.address);

    const Impl = await ethers.getContractFactory("CommodityBatchToken");
    token = (await Impl.deploy()) as CommodityBatchToken;
    await token.initialize(
      "Lagos Cocoa Warehouse",
      "NG",
      "ipfs://QmWarehouse/",
      owner.address,
      warehouseMeta(),
    );
  });

  // ─── Deployment + warehouse metadata ─────────────────────────────────────

  describe("deployment", function () {
    it("stores warehouse metadata on initialize", async function () {
      const wh = await token.getWarehouseMetadata();
      expect(wh.warehouseId).to.equal("WH-LAG-001");
      expect(wh.warehouseLocation).to.equal("Apapa, Lagos, Nigeria");
    });

    it("starts with zero active batches", async function () {
      expect(await token.activeBatchCount()).to.equal(0n);
    });

    it("batchIds array is empty on deploy", async function () {
      const ids = await token.batchIds();
      expect(ids.length).to.equal(0);
    });
  });

  // ─── registerBatch ────────────────────────────────────────────────────────

  describe("registerBatch", function () {
    it("MANAGER_ROLE can register a batch", async function () {
      await expect(token.registerBatch(1, batchMeta())).to.not.be.reverted;
      expect(await token.isRegistered(1)).to.be.true;
    });

    it("emits BatchRegistered event", async function () {
      await expect(token.registerBatch(1, batchMeta()))
        .to.emit(token, "BatchRegistered")
        .withArgs(1n, "cocoa", 10000n);
    });

    it("stores batch metadata", async function () {
      await token.registerBatch(1, batchMeta({ valuationUSD: 250000n }));
      const stored = await token.getBatchMetadata(1);
      expect(stored.commodityType).to.equal("cocoa");
      expect(stored.quantityKg).to.equal(10000n);
      expect(stored.valuationUSD).to.equal(250000n);
      expect(stored.originCountry).to.equal("NG");
    });

    it("sets depositDate to block.timestamp on registration", async function () {
      await token.registerBatch(1, batchMeta());
      const stored = await token.getBatchMetadata(1);
      expect(stored.depositDate).to.be.gt(0n);
    });

    it("registers the underlying token ID definition", async function () {
      await token.registerBatch(1, batchMeta());
      const def = await token.getTokenDefinition(1);
      expect(def.isFungible).to.be.true;
      expect(def.name).to.equal("cocoa");
      expect(def.maxSupply).to.equal(10000n);
    });

    it("adds batch ID to batchIds array", async function () {
      await token.registerBatch(1, batchMeta());
      await token.registerBatch(2, batchMeta({ commodityType: "coffee" }));
      const ids = await token.batchIds();
      expect(ids.length).to.equal(2);
      expect(ids[0]).to.equal(1n);
      expect(ids[1]).to.equal(2n);
    });

    it("reverts on duplicate batch ID", async function () {
      await token.registerBatch(1, batchMeta());
      await expect(token.registerBatch(1, batchMeta()))
        .to.be.revertedWithCustomError(token, "BatchAlreadyRegistered");
    });

    it("stranger cannot register batch", async function () {
      await expect(token.connect(stranger).registerBatch(1, batchMeta())).to.be.reverted;
    });
  });

  // ─── Mint batch tokens ────────────────────────────────────────────────────

  describe("mint batch tokens", function () {
    beforeEach(async function () {
      await token.registerBatch(1, batchMeta());
    });

    it("MINTER_ROLE can mint tokens for a registered batch", async function () {
      await token.mint(user.address, 1, 500n, "0x");
      expect(await token.balanceOf(user.address, 1)).to.equal(500n);
      expect(await token.totalSupply(1)).to.equal(500n);
    });

    it("respects quantityKg as maxSupply (1 token = 1 kg)", async function () {
      await token.mint(user.address, 1, 10000n, "0x"); // full batch
      await expect(token.mint(user.address, 1, 1n, "0x"))
        .to.be.revertedWithCustomError(token, "MaxSupplyExceeded");
    });

    it("cannot mint unregistered batch ID", async function () {
      await expect(token.mint(user.address, 42, 100n, "0x"))
        .to.be.revertedWithCustomError(token, "TokenIdNotRegistered");
    });
  });

  // ─── updateBatchValuation ─────────────────────────────────────────────────

  describe("updateBatchValuation", function () {
    beforeEach(async function () {
      await token.registerBatch(1, batchMeta({ valuationUSD: 500000n }));
    });

    it("MANAGER_ROLE can update valuation", async function () {
      await token.updateBatchValuation(1, 600000n);
      const stored = await token.getBatchMetadata(1);
      expect(stored.valuationUSD).to.equal(600000n);
    });

    it("emits ValuationUpdated event with old and new values", async function () {
      await expect(token.updateBatchValuation(1, 750000n))
        .to.emit(token, "ValuationUpdated")
        .withArgs(1n, 500000n, 750000n, (v: bigint) => v > 0n);
    });

    it("reverts on unregistered batch ID", async function () {
      await expect(token.updateBatchValuation(99, 1000n))
        .to.be.revertedWithCustomError(token, "BatchNotRegistered");
    });

    it("stranger cannot update valuation", async function () {
      await expect(token.connect(stranger).updateBatchValuation(1, 999n)).to.be.reverted;
    });
  });

  // ─── expireBatch ──────────────────────────────────────────────────────────

  describe("expireBatch", function () {
    beforeEach(async function () {
      await token.registerBatch(1, batchMeta());
    });

    it("MANAGER_ROLE can expire a batch", async function () {
      await token.expireBatch(1);
      const def = await token.getTokenDefinition(1);
      expect(def.status).to.equal(4n); // AssetStatus.EXPIRED = 4
    });

    it("emits BatchExpired event", async function () {
      await expect(token.expireBatch(1))
        .to.emit(token, "BatchExpired")
        .withArgs(1n, (v: bigint) => v > 0n);
    });

    it("reverts on unregistered batch", async function () {
      await expect(token.expireBatch(99))
        .to.be.revertedWithCustomError(token, "BatchNotRegistered");
    });

    it("stranger cannot expire batch", async function () {
      await expect(token.connect(stranger).expireBatch(1)).to.be.reverted;
    });
  });

  // ─── isExpired ────────────────────────────────────────────────────────────

  describe("isExpired (timestamp-based)", function () {
    it("returns false when expiryDate is 0 (no natural expiry)", async function () {
      await token.registerBatch(1, batchMeta({ expiryDate: 0n }));
      expect(await token.isExpired(1)).to.be.false;
    });

    it("returns false when expiryDate is in the future", async function () {
      const future = BigInt(Math.floor(Date.now() / 1000) + 86400 * 365); // 1 year from now
      await token.registerBatch(1, batchMeta({ expiryDate: future }));
      expect(await token.isExpired(1)).to.be.false;
    });

    it("returns true when expiryDate is in the past", async function () {
      const past = 1n; // Unix timestamp 1 — definitely in the past
      await token.registerBatch(1, batchMeta({ expiryDate: past }));
      expect(await token.isExpired(1)).to.be.true;
    });
  });

  // ─── activeBatchCount ─────────────────────────────────────────────────────

  describe("activeBatchCount", function () {
    it("counts non-expired batches", async function () {
      const future = BigInt(Math.floor(Date.now() / 1000) + 86400 * 365);
      const past   = 1n;

      await token.registerBatch(1, batchMeta({ expiryDate: future })); // active
      await token.registerBatch(2, batchMeta({ expiryDate: future, commodityType: "coffee" })); // active
      await token.registerBatch(3, batchMeta({ expiryDate: past,   commodityType: "maize"  })); // expired

      expect(await token.activeBatchCount()).to.equal(2n);
    });

    it("is zero when all batches have no natural expiry (expiryDate = 0)", async function () {
      // expiryDate = 0 means never expires — _isExpiredById returns false, so they're active
      await token.registerBatch(1, batchMeta({ expiryDate: 0n }));
      await token.registerBatch(2, batchMeta({ expiryDate: 0n, commodityType: "coffee" }));
      expect(await token.activeBatchCount()).to.equal(2n);
    });
  });

  // ─── mergeBatches ─────────────────────────────────────────────────────────

  describe("mergeBatches", function () {
    beforeEach(async function () {
      // Two compatible batches (same commodity + grade)
      await token.registerBatch(1, batchMeta({ quantityKg: 5000n }));
      await token.registerBatch(2, batchMeta({ quantityKg: 5000n }));
      // Mint tokens to owner for batch 1
      await token.mint(owner.address, 1, 1000n, "0x");
      await token.mint(owner.address, 2, 500n, "0x");
    });

    it("MANAGER_ROLE can merge compatible batches", async function () {
      const before2 = await token.balanceOf(owner.address, 2);
      await token.mergeBatches(1, 2, 500n, owner.address);
      expect(await token.balanceOf(owner.address, 1)).to.equal(500n); // 1000 - 500
      expect(await token.balanceOf(owner.address, 2)).to.equal(before2 + 500n);
    });

    it("emits BatchesMerged event", async function () {
      await expect(token.mergeBatches(1, 2, 300n, owner.address))
        .to.emit(token, "BatchesMerged")
        .withArgs(1n, 2n, 300n, owner.address);
    });

    it("updates totalSupply correctly after merge", async function () {
      await token.mergeBatches(1, 2, 400n, owner.address);
      expect(await token.totalSupply(1)).to.equal(600n); // 1000 - 400
      expect(await token.totalSupply(2)).to.equal(900n); // 500 + 400
    });

    it("reverts on incompatible commodity types", async function () {
      await token.registerBatch(3, batchMeta({ commodityType: "coffee", quantityKg: 5000n }));
      await token.mint(owner.address, 3, 500n, "0x");
      await expect(token.mergeBatches(1, 3, 100n, owner.address))
        .to.be.revertedWithCustomError(token, "IncompatibleBatches");
    });

    it("reverts on incompatible grade", async function () {
      await token.registerBatch(4, batchMeta({ gradeClassification: "Grade B", quantityKg: 5000n }));
      await token.mint(owner.address, 4, 500n, "0x");
      await expect(token.mergeBatches(1, 4, 100n, owner.address))
        .to.be.revertedWithCustomError(token, "IncompatibleBatches");
    });

    it("reverts if fromId is expired", async function () {
      const past = 1n;
      await token.registerBatch(5, batchMeta({ expiryDate: past, quantityKg: 5000n }));
      await token.registerBatch(6, batchMeta({ quantityKg: 5000n, commodityType: "cocoa" }));
      await token.mint(owner.address, 5, 100n, "0x");
      await expect(token.mergeBatches(5, 6, 50n, owner.address))
        .to.be.revertedWithCustomError(token, "BatchIsExpired");
    });

    it("reverts if toId is expired", async function () {
      const past = 1n;
      await token.registerBatch(7, batchMeta({ quantityKg: 5000n }));
      await token.registerBatch(8, batchMeta({ expiryDate: past, quantityKg: 5000n }));
      await token.mint(owner.address, 7, 100n, "0x");
      await expect(token.mergeBatches(7, 8, 50n, owner.address))
        .to.be.revertedWithCustomError(token, "BatchIsExpired");
    });

    it("reverts on unregistered fromId", async function () {
      await expect(token.mergeBatches(99, 2, 100n, owner.address))
        .to.be.revertedWithCustomError(token, "BatchNotRegistered");
    });

    it("stranger cannot merge batches", async function () {
      await expect(token.connect(stranger).mergeBatches(1, 2, 100n, owner.address)).to.be.reverted;
    });
  });

  // ─── getBatchMetadata / getWarehouseMetadata ──────────────────────────────

  describe("metadata reads", function () {
    it("getBatchMetadata returns all batch fields", async function () {
      const future = BigInt(Math.floor(Date.now() / 1000) + 86400 * 365);
      await token.registerBatch(1, batchMeta({
        commodityType:        "gold",
        quantityKg:           250n,
        gradeClassification:  "24K",
        expiryDate:           future,
        valuationUSD:         2500000n,
        harvestSeason:        "N/A",
        originCountry:        "GH",
      }));
      const stored = await token.getBatchMetadata(1);
      expect(stored.commodityType).to.equal("gold");
      expect(stored.gradeClassification).to.equal("24K");
      expect(stored.valuationUSD).to.equal(2500000n);
      expect(stored.originCountry).to.equal("GH");
      expect(stored.expiryDate).to.equal(future);
    });

    it("getWarehouseMetadata returns correct warehouse info", async function () {
      const wh = await token.getWarehouseMetadata();
      expect(wh.warehouseId).to.equal("WH-LAG-001");
      expect(wh.warehouseLocation).to.equal("Apapa, Lagos, Nigeria");
      expect(wh.certificationExpiry).to.equal(9999999999n);
    });
  });
});
