import { expect } from "chai";
import { ethers } from "hardhat";
import type { CommodityBatchToken, WhitelistVerifier } from "../typechain-types";

/**
 * AnkaraMultiToken — tests via CommodityBatchToken (simplest concrete ERC-1155 implementation).
 * Mirrors the pattern used in AnkaraNFTBase.test.ts (tested via FarmlandNFT).
 */
describe("AnkaraMultiToken (via CommodityBatchToken)", function () {
  let token: CommodityBatchToken;
  let verifier: WhitelistVerifier;
  let owner: any, minter: any, user: any, stranger: any;

  const NAME    = "Lagos Cocoa Warehouse";
  const COUNTRY = "NG";
  const BASE_URI = "ipfs://QmWarehouse/";

  const warehouseMeta = () => ({
    warehouseId:          "WH-LAG-001",
    warehouseLocation:    "Lagos, Nigeria",
    operatorAddress:      ethers.ZeroAddress,
    warehouseLicenseHash: ethers.ZeroHash,
    certificationExpiry:  BigInt(9999999999),
  });

  // Simple batch metadata (no expiry — expiryDate = 0 means never)
  const batchMeta = (commodityType = "cocoa", grade = "Grade A") => ({
    commodityType,
    quantityKg:           10000n,
    gradeClassification:  grade,
    depositDate:          0n,  // overwritten on-chain
    expiryDate:           0n,  // 0 = no natural expiry (use expireBatch for manual)
    inspectionReportHash: ethers.ZeroHash,
    valuationUSD:         500000n,
    harvestSeason:        "2025-Q1",
    originCountry:        "NG",
  });

  beforeEach(async function () {
    [owner, minter, user, stranger] = await ethers.getSigners();

    verifier = await (await ethers.getContractFactory("WhitelistVerifier"))
      .deploy(owner.address);

    const Impl = await ethers.getContractFactory("CommodityBatchToken");
    token = (await Impl.deploy()) as CommodityBatchToken;
    await token.initialize(NAME, COUNTRY, BASE_URI, owner.address, warehouseMeta());
  });

  // ─── Deployment ───────────────────────────────────────────────────────────

  describe("deployment", function () {
    it("sets contract name and country code", async function () {
      expect(await token.contractName()).to.equal(NAME);
      expect(await token.contractCountryCode()).to.equal(COUNTRY);
    });

    it("grants all roles to admin", async function () {
      const MINTER   = await token.MINTER_ROLE();
      const PAUSER   = await token.PAUSER_ROLE();
      const UPGRADER = await token.UPGRADER_ROLE();
      const MANAGER  = await token.MANAGER_ROLE();

      expect(await token.hasRole(MINTER,   owner.address)).to.be.true;
      expect(await token.hasRole(PAUSER,   owner.address)).to.be.true;
      expect(await token.hasRole(UPGRADER, owner.address)).to.be.true;
      expect(await token.hasRole(MANAGER,  owner.address)).to.be.true;
    });

    it("starts with no registered token IDs", async function () {
      expect(await token.isRegistered(1)).to.be.false;
      expect(await token.totalSupply(1)).to.equal(0);
    });

    it("supports ERC-1155 interface", async function () {
      // ERC-1155 interface ID = 0xd9b67a26
      expect(await token.supportsInterface("0xd9b67a26")).to.be.true;
    });

    it("supports AccessControl interface", async function () {
      // IAccessControl interface ID = 0x7965db0b
      expect(await token.supportsInterface("0x7965db0b")).to.be.true;
    });
  });

  // ─── registerTokenId ──────────────────────────────────────────────────────

  describe("registerTokenId", function () {
    it("MANAGER_ROLE can register a token ID", async function () {
      const def = {
        isFungible:  true,
        name:        "Test Token",
        symbol:      "TST",
        maxSupply:   1000n,
        status:      0, // DRAFT
        metadataURI: "ipfs://QmTest",
      };
      await expect(token.registerTokenId(99, def)).to.not.be.reverted;
      expect(await token.isRegistered(99)).to.be.true;
    });

    it("emits TokenIdRegistered event", async function () {
      const def = {
        isFungible:  true,
        name:        "Test Token",
        symbol:      "TST",
        maxSupply:   0n,
        status:      0,
        metadataURI: "",
      };
      await expect(token.registerTokenId(1, def))
        .to.emit(token, "TokenIdRegistered")
        .withArgs(1n, true, "Test Token");
    });

    it("reverts on duplicate registration", async function () {
      const def = {
        isFungible: true, name: "T", symbol: "", maxSupply: 0n, status: 0, metadataURI: "",
      };
      await token.registerTokenId(5, def);
      await expect(token.registerTokenId(5, def))
        .to.be.revertedWithCustomError(token, "TokenIdAlreadyRegistered");
    });

    it("stranger cannot register", async function () {
      const def = {
        isFungible: false, name: "T", symbol: "", maxSupply: 0n, status: 0, metadataURI: "",
      };
      await expect(token.connect(stranger).registerTokenId(1, def)).to.be.reverted;
    });

    it("getTokenDefinition returns stored definition", async function () {
      const def = {
        isFungible:  true,
        name:        "Lagos Cocoa Batch",
        symbol:      "LCB",
        maxSupply:   5000n,
        status:      1, // ACTIVE
        metadataURI: "ipfs://QmCocoa",
      };
      await token.registerTokenId(10, def);
      const stored = await token.getTokenDefinition(10);
      expect(stored.name).to.equal("Lagos Cocoa Batch");
      expect(stored.maxSupply).to.equal(5000n);
      expect(stored.isFungible).to.be.true;
    });
  });

  // ─── setTokenVerifier ─────────────────────────────────────────────────────

  describe("setTokenVerifier", function () {
    it("MANAGER_ROLE can set a verifier for a token ID", async function () {
      await token.registerBatch(1, batchMeta());
      await expect(
        token.setTokenVerifier(1, await verifier.getAddress())
      ).to.not.be.reverted;
    });

    it("emits TokenVerifierUpdated event", async function () {
      await token.registerBatch(1, batchMeta());
      const vAddr = await verifier.getAddress();
      await expect(token.setTokenVerifier(1, vAddr))
        .to.emit(token, "TokenVerifierUpdated")
        .withArgs(1n, ethers.ZeroAddress, vAddr);
    });

    it("stranger cannot set verifier", async function () {
      await token.registerBatch(1, batchMeta());
      await expect(
        token.connect(stranger).setTokenVerifier(1, await verifier.getAddress())
      ).to.be.reverted;
    });
  });

  // ─── Minting ──────────────────────────────────────────────────────────────

  describe("mint", function () {
    beforeEach(async function () {
      await token.registerBatch(1, batchMeta());
    });

    it("MINTER_ROLE can mint registered tokens", async function () {
      await expect(token.mint(user.address, 1, 100n, "0x")).to.not.be.reverted;
      expect(await token.balanceOf(user.address, 1)).to.equal(100n);
    });

    it("totalSupply updates on mint", async function () {
      await token.mint(user.address, 1, 200n, "0x");
      expect(await token.totalSupply(1)).to.equal(200n);
    });

    it("reverts when minting unregistered token ID", async function () {
      await expect(token.mint(user.address, 99, 100n, "0x"))
        .to.be.revertedWithCustomError(token, "TokenIdNotRegistered");
    });

    it("enforces maxSupply", async function () {
      // batchMeta has quantityKg = 10000 as maxSupply
      await token.mint(user.address, 1, 10000n, "0x");
      await expect(token.mint(user.address, 1, 1n, "0x"))
        .to.be.revertedWithCustomError(token, "MaxSupplyExceeded");
    });

    it("stranger cannot mint", async function () {
      await expect(token.connect(stranger).mint(user.address, 1, 10n, "0x")).to.be.reverted;
    });

    it("emits TransferSingle event on mint", async function () {
      await expect(token.mint(user.address, 1, 50n, "0x"))
        .to.emit(token, "TransferSingle");
    });
  });

  // ─── mintBatch ────────────────────────────────────────────────────────────

  describe("mintBatch", function () {
    beforeEach(async function () {
      await token.registerBatch(1, batchMeta("cocoa", "Grade A"));
      await token.registerBatch(2, batchMeta("coffee", "Premium"));
    });

    it("mints multiple IDs in one call", async function () {
      await token.mintBatch(user.address, [1, 2], [100n, 200n], "0x");
      expect(await token.balanceOf(user.address, 1)).to.equal(100n);
      expect(await token.balanceOf(user.address, 2)).to.equal(200n);
    });

    it("reverts if any ID is unregistered", async function () {
      await expect(token.mintBatch(user.address, [1, 99], [100n, 50n], "0x"))
        .to.be.revertedWithCustomError(token, "TokenIdNotRegistered");
    });
  });

  // ─── burn / burnBatch ─────────────────────────────────────────────────────

  describe("burn / burnBatch", function () {
    beforeEach(async function () {
      await token.registerBatch(1, batchMeta());
      await token.mint(user.address, 1, 500n, "0x");
    });

    it("holder can burn their own tokens", async function () {
      await expect(token.connect(user).burn(user.address, 1, 100n)).to.not.be.reverted;
      expect(await token.balanceOf(user.address, 1)).to.equal(400n);
    });

    it("totalSupply decreases on burn", async function () {
      await token.connect(user).burn(user.address, 1, 200n);
      expect(await token.totalSupply(1)).to.equal(300n);
    });

    it("stranger cannot burn holder's tokens", async function () {
      await expect(token.connect(stranger).burn(user.address, 1, 100n)).to.be.reverted;
    });
  });

  // ─── Identity verifier hook ───────────────────────────────────────────────

  describe("identity verifier hook (per token ID)", function () {
    beforeEach(async function () {
      await token.registerBatch(1, batchMeta());
      await token.setTokenVerifier(1, await verifier.getAddress());
    });

    it("blocks mint to unverified address", async function () {
      await expect(token.mint(user.address, 1, 100n, "0x"))
        .to.be.revertedWithCustomError(token, "NotVerified");
    });

    it("allows mint after verification", async function () {
      await verifier.verifyIdentity(user.address);
      await expect(token.mint(user.address, 1, 100n, "0x")).to.not.be.reverted;
    });

    it("blocks transfer to unverified address", async function () {
      await verifier.verifyIdentity(user.address);
      await token.mint(user.address, 1, 100n, "0x");

      await expect(
        token.connect(user).safeTransferFrom(user.address, stranger.address, 1, 50n, "0x")
      ).to.be.revertedWithCustomError(token, "NotVerified");
    });

    it("allows transfer between verified addresses", async function () {
      await verifier.verifyIdentity(user.address);
      await verifier.verifyIdentity(stranger.address);
      await token.mint(user.address, 1, 100n, "0x");

      await expect(
        token.connect(user).safeTransferFrom(user.address, stranger.address, 1, 50n, "0x")
      ).to.not.be.reverted;

      expect(await token.balanceOf(stranger.address, 1)).to.equal(50n);
    });

    it("ID without verifier transfers freely", async function () {
      // Register a second batch without verifier
      await token.registerBatch(2, batchMeta("coffee"));
      await token.mint(user.address, 2, 100n, "0x");

      await expect(
        token.connect(user).safeTransferFrom(user.address, stranger.address, 2, 50n, "0x")
      ).to.not.be.reverted;
    });
  });

  // ─── Pause / Unpause ──────────────────────────────────────────────────────

  describe("pause / unpause", function () {
    beforeEach(async function () {
      await token.registerBatch(1, batchMeta());
      await token.mint(user.address, 1, 100n, "0x");
    });

    it("PAUSER_ROLE can pause", async function () {
      await expect(token.pause()).to.not.be.reverted;
    });

    it("transfers are blocked when paused", async function () {
      await token.pause();
      await expect(
        token.connect(user).safeTransferFrom(user.address, stranger.address, 1, 10n, "0x")
      ).to.be.reverted;
    });

    it("stranger cannot pause", async function () {
      await expect(token.connect(stranger).pause()).to.be.reverted;
    });

    it("PAUSER_ROLE can unpause", async function () {
      await token.pause();
      await expect(token.unpause()).to.not.be.reverted;
    });

    it("transfers resume after unpause", async function () {
      await token.pause();
      await token.unpause();
      await expect(
        token.connect(user).safeTransferFrom(user.address, stranger.address, 1, 10n, "0x")
      ).to.not.be.reverted;
    });
  });

  // ─── uri ──────────────────────────────────────────────────────────────────

  describe("uri()", function () {
    it("returns base URI when no token-level URI is set", async function () {
      await token.registerBatch(1, batchMeta());
      // batchMeta sets metadataURI = "" — falls back to base URI
      const result = await token.uri(1);
      expect(result).to.equal(BASE_URI);
    });

    it("returns token-level URI when set via registerTokenId", async function () {
      const def = {
        isFungible: true, name: "T", symbol: "", maxSupply: 0n, status: 0,
        metadataURI: "ipfs://QmSpecificToken",
      };
      await token.registerTokenId(50, def);
      expect(await token.uri(50)).to.equal("ipfs://QmSpecificToken");
    });
  });
});
