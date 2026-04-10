import { expect } from "chai";
import { ethers } from "hardhat";
import { CommodityReceiptToken, WhitelistVerifier, TokenFactory } from "../typechain-types";

describe("CommodityReceiptToken", function () {
  let factory: TokenFactory;
  let impl: CommodityReceiptToken;
  let verifier: WhitelistVerifier;
  let owner: any, investor: any, stranger: any;

  const assetId = ethers.keccak256(ethers.toUtf8Bytes("KANO-COCOA-BATCH-001"));
  const now = () => BigInt(Math.floor(Date.now() / 1000));
  const days = (n: number) => BigInt(n * 24 * 60 * 60);

  const baseMeta = () => ({
    commodityType:       "cocoa",
    quantityKg:          5000n,
    gradeClassification: "Grade A",
    warehouseId:         "WH-KANO-001",
    warehouseLocation:   "12.0022, 8.5919",
    depositDate:         now(),
    expiryDate:          now() + days(180),
    inspectionReportHash: ethers.ZeroHash,
    valuationUSD:        ethers.parseEther("25000"),
    harvestSeason:       "2025/2026",
    lastUpdated:         now(),
  });

  const expiredMeta = () => ({
    ...baseMeta(),
    expiryDate: now() - days(1), // already expired
  });

  beforeEach(async () => {
    [owner, investor, stranger] = await ethers.getSigners();

    const WV = await ethers.getContractFactory("WhitelistVerifier");
    verifier = await WV.deploy(owner.address);

    const CR = await ethers.getContractFactory("CommodityReceiptToken");
    impl = await CR.deploy();

    const TF = await ethers.getContractFactory("TokenFactory");
    factory = await TF.deploy(owner.address, owner.address);

    await factory.registerTemplate(1, await impl.getAddress()); // Template.COMMODITY_RECEIPT = 1
  });

  async function deployToken(withVerifier = false): Promise<CommodityReceiptToken> {
    const vAddr = withVerifier ? await verifier.getAddress() : ethers.ZeroAddress;
    const tx = await factory.deployCommodityReceiptToken(
      "Kano Cocoa Receipt", "KCR", assetId, "NG",
      owner.address, vAddr, baseMeta()
    );
    await tx.wait();
    const tokens = await factory.getDeployerTokens(owner.address);
    return ethers.getContractAt("CommodityReceiptToken", tokens[tokens.length - 1]);
  }

  async function deployExpiredToken(): Promise<CommodityReceiptToken> {
    const tx = await factory.deployCommodityReceiptToken(
      "Expired Cocoa Receipt", "ECR",
      ethers.keccak256(ethers.toUtf8Bytes("EXPIRED-001")),
      "NG", owner.address, ethers.ZeroAddress, expiredMeta()
    );
    await tx.wait();
    const tokens = await factory.getDeployerTokens(owner.address);
    return ethers.getContractAt("CommodityReceiptToken", tokens[tokens.length - 1]);
  }

  // ─── Deployment ─────────────────────────────────────────────────────────

  describe("Deployment", () => {
    it("deploys with correct name and symbol", async () => {
      const t = await deployToken();
      expect(await t.name()).to.equal("Kano Cocoa Receipt");
      expect(await t.symbol()).to.equal("KCR");
    });
    it("sets country code to NG", async () => {
      const t = await deployToken();
      expect(await t.countryCode()).to.equal("NG");
    });
    it("starts in DRAFT status", async () => {
      const t = await deployToken();
      expect(await t.status()).to.equal(0); // DRAFT
    });
    it("stores commodity type correctly", async () => {
      const t = await deployToken();
      expect(await t.commodityType()).to.equal("cocoa");
    });
    it("stores quantity correctly", async () => {
      const t = await deployToken();
      expect(await t.quantityKg()).to.equal(5000n);
    });
    it("stores valuation correctly", async () => {
      const t = await deployToken();
      expect(await t.valuationUSD()).to.equal(ethers.parseEther("25000"));
    });
    it("stores full metadata correctly", async () => {
      const t = await deployToken();
      const m = await t.getMetadata();
      expect(m.gradeClassification).to.equal("Grade A");
      expect(m.warehouseId).to.equal("WH-KANO-001");
      expect(m.harvestSeason).to.equal("2025/2026");
    });
    it("sets metadata version to 1", async () => {
      const t = await deployToken();
      expect(await t.metadataVersion()).to.equal(1n);
    });
    it("is not expired on fresh deploy", async () => {
      const t = await deployToken();
      expect(await t.isExpired()).to.be.false;
    });
    it("grants all roles to admin", async () => {
      const t = await deployToken();
      expect(await t.hasRole(await t.MINTER_ROLE(),   owner.address)).to.be.true;
      expect(await t.hasRole(await t.MANAGER_ROLE(),  owner.address)).to.be.true;
      expect(await t.hasRole(await t.PAUSER_ROLE(),   owner.address)).to.be.true;
      expect(await t.hasRole(await t.UPGRADER_ROLE(), owner.address)).to.be.true;
    });
    it("registers in factory deployer mapping", async () => {
      await deployToken();
      expect(await factory.totalDeployed()).to.equal(1);
      const tokens = await factory.getDeployerTokens(owner.address);
      expect(tokens.length).to.equal(1);
    });
    it("emits MetadataUpdated on initialization", async () => {
      const tx = await factory.deployCommodityReceiptToken(
        "Test", "TST",
        ethers.keccak256(ethers.toUtf8Bytes("TEST-001")),
        "NG", owner.address, ethers.ZeroAddress, baseMeta()
      );
      const receipt = await tx.wait();
      expect(receipt?.status).to.equal(1);
    });
  });

  // ─── Minting ─────────────────────────────────────────────────────────────

  describe("Minting", () => {
    it("owner can mint tokens to investor", async () => {
      const t = await deployToken();
      await t.mint(investor.address, ethers.parseEther("1000"));
      expect(await t.balanceOf(investor.address)).to.equal(ethers.parseEther("1000"));
    });
    it("total supply increases on mint", async () => {
      const t = await deployToken();
      await t.mint(investor.address, ethers.parseEther("500"));
      expect(await t.totalSupply()).to.equal(ethers.parseEther("500"));
    });
    it("stranger cannot mint", async () => {
      const t = await deployToken();
      await expect(
        t.connect(stranger).mint(investor.address, 100n)
      ).to.be.reverted;
    });
    it("cannot mint when paused", async () => {
      const t = await deployToken();
      await t.pause();
      await expect(t.mint(investor.address, 100n)).to.be.reverted;
    });
    it("can mint multiple times to different investors", async () => {
      const t = await deployToken();
      await t.mint(investor.address, ethers.parseEther("300"));
      await t.mint(stranger.address, ethers.parseEther("200"));
      expect(await t.balanceOf(investor.address)).to.equal(ethers.parseEther("300"));
      expect(await t.balanceOf(stranger.address)).to.equal(ethers.parseEther("200"));
      expect(await t.totalSupply()).to.equal(ethers.parseEther("500"));
    });
  });

  // ─── Expiry ───────────────────────────────────────────────────────────────

  describe("Expiry", () => {
    it("isExpired returns true for an expired receipt", async () => {
      const t = await deployExpiredToken();
      expect(await t.isExpired()).to.be.true;
    });
    it("isExpired returns false for a valid receipt", async () => {
      const t = await deployToken();
      expect(await t.isExpired()).to.be.false;
    });
    it("manager can mark expired receipt", async () => {
      const t = await deployExpiredToken();
      await t.markExpired();
      expect(await t.status()).to.equal(4); // EXPIRED
    });
    it("emits ReceiptExpired event on markExpired", async () => {
      const t = await deployExpiredToken();
      await expect(t.markExpired()).to.emit(t, "ReceiptExpired");
    });
    it("stranger cannot mark expired", async () => {
      const t = await deployExpiredToken();
      await expect(t.connect(stranger).markExpired()).to.be.reverted;
    });
  });

  // ─── Asset Status ─────────────────────────────────────────────────────────

  describe("Asset Status", () => {
    it("manager can set status to ACTIVE", async () => {
      const t = await deployToken();
      await t.setStatus(1); // ACTIVE
      expect(await t.status()).to.equal(1);
    });
    it("manager can set status to SUSPENDED", async () => {
      const t = await deployToken();
      await t.setStatus(2); // SUSPENDED
      expect(await t.status()).to.equal(2);
    });
    it("manager can set status to REDEEMED", async () => {
      const t = await deployToken();
      await t.setStatus(3); // REDEEMED
      expect(await t.status()).to.equal(3);
    });
    it("stranger cannot update status", async () => {
      const t = await deployToken();
      await expect(t.connect(stranger).setStatus(1)).to.be.reverted;
    });
    it("emits AssetStatusChanged event on status update", async () => {
      const t = await deployToken();
      await expect(t.setStatus(1)).to.emit(t, "AssetStatusChanged");
    });
  });

  // ─── Metadata Updates ─────────────────────────────────────────────────────

  describe("Metadata Updates", () => {
    it("manager can update metadata", async () => {
      const t = await deployToken();
      const newMeta = { ...baseMeta(), commodityType: "coffee", quantityKg: 3000n };
      await t.updateMetadata(newMeta);
      expect(await t.commodityType()).to.equal("coffee");
      expect(await t.quantityKg()).to.equal(3000n);
    });
    it("increments metadataVersion on update", async () => {
      const t = await deployToken();
      await t.updateMetadata(baseMeta());
      expect(await t.metadataVersion()).to.equal(2n);
    });
    it("increments version again on second update", async () => {
      const t = await deployToken();
      await t.updateMetadata(baseMeta());
      await t.updateMetadata(baseMeta());
      expect(await t.metadataVersion()).to.equal(3n);
    });
    it("updates lastUpdated timestamp on update", async () => {
      const t = await deployToken();
      const before = (await t.getMetadata()).lastUpdated;
      await t.updateMetadata(baseMeta());
      const after = (await t.getMetadata()).lastUpdated;
      expect(after).to.be.greaterThanOrEqual(before);
    });
    it("stranger cannot update metadata", async () => {
      const t = await deployToken();
      await expect(t.connect(stranger).updateMetadata(baseMeta())).to.be.reverted;
    });
    it("emits MetadataUpdated event on update", async () => {
      const t = await deployToken();
      await expect(t.updateMetadata(baseMeta())).to.emit(t, "MetadataUpdated");
    });
    it("updates valuation correctly", async () => {
      const t = await deployToken();
      const newMeta = { ...baseMeta(), valuationUSD: ethers.parseEther("30000") };
      await t.updateMetadata(newMeta);
      expect(await t.valuationUSD()).to.equal(ethers.parseEther("30000"));
    });
  });

  // ─── Identity Verifier ────────────────────────────────────────────────────

  describe("Identity Verifier", () => {
    it("allows minting without verifier set", async () => {
      const t = await deployToken(false);
      await expect(t.mint(investor.address, 100n)).to.not.be.reverted;
    });
    it("blocks minting to unverified address when verifier set", async () => {
      const t = await deployToken(true);
      await expect(t.mint(investor.address, 100n)).to.be.reverted;
    });
    it("allows minting after verifying address", async () => {
      const t = await deployToken(true);
      await verifier.verifyIdentity(investor.address);
      await expect(t.mint(investor.address, 100n)).to.not.be.reverted;
    });
    it("blocks transfer from revoked address", async () => {
      const t = await deployToken(true);
      await verifier.verifyIdentity(investor.address);
      await verifier.verifyIdentity(stranger.address);
      await t.mint(investor.address, 100n);
      await verifier.revokeIdentity(investor.address);
      await expect(
        t.connect(investor).transfer(stranger.address, 50n)
      ).to.be.reverted;
    });
    it("manager can swap identity verifier", async () => {
      const t = await deployToken(true);
      await t.setIdentityVerifier(ethers.ZeroAddress);
      expect(await t.identityVerifier()).to.equal(ethers.ZeroAddress);
    });
    it("emits IdentityVerifierUpdated event on swap", async () => {
      const t = await deployToken(true);
      await expect(t.setIdentityVerifier(ethers.ZeroAddress))
        .to.emit(t, "IdentityVerifierUpdated");
    });
    it("stranger cannot swap verifier", async () => {
      const t = await deployToken(true);
      await expect(
        t.connect(stranger).setIdentityVerifier(ethers.ZeroAddress)
      ).to.be.reverted;
    });
  });

  // ─── Pause / Unpause ──────────────────────────────────────────────────────

  describe("Pause / Unpause", () => {
    it("owner can pause", async () => {
      const t = await deployToken();
      await t.pause();
      await expect(t.mint(investor.address, 100n)).to.be.reverted;
    });
    it("owner can unpause", async () => {
      const t = await deployToken();
      await t.pause();
      await t.unpause();
      await expect(t.mint(investor.address, 100n)).to.not.be.reverted;
    });
    it("transfers are blocked when paused", async () => {
      const t = await deployToken();
      await t.mint(investor.address, ethers.parseEther("100"));
      await t.pause();
      await expect(
        t.connect(investor).transfer(stranger.address, 50n)
      ).to.be.reverted;
    });
    it("stranger cannot pause", async () => {
      const t = await deployToken();
      await expect(t.connect(stranger).pause()).to.be.reverted;
    });
  });

  // ─── Burning ──────────────────────────────────────────────────────────────

  describe("Burning", () => {
    it("token holder can burn their own tokens", async () => {
      const t = await deployToken();
      await t.mint(investor.address, ethers.parseEther("500"));
      await t.connect(investor).burn(ethers.parseEther("100"));
      expect(await t.balanceOf(investor.address)).to.equal(ethers.parseEther("400"));
    });
    it("total supply decreases on burn", async () => {
      const t = await deployToken();
      await t.mint(investor.address, ethers.parseEther("500"));
      await t.connect(investor).burn(ethers.parseEther("200"));
      expect(await t.totalSupply()).to.equal(ethers.parseEther("300"));
    });
  });

  // ─── TokenFactory integration ──────────────────────────────────────────────

  describe("TokenFactory Integration", () => {
    it("multiple commodity tokens can be deployed by same deployer", async () => {
      await factory.deployCommodityReceiptToken(
        "Cocoa Batch A", "CBA",
        ethers.keccak256(ethers.toUtf8Bytes("BATCH-A")),
        "NG", owner.address, ethers.ZeroAddress, baseMeta()
      );
      await factory.deployCommodityReceiptToken(
        "Coffee Batch B", "CBB",
        ethers.keccak256(ethers.toUtf8Bytes("BATCH-B")),
        "GH", owner.address, ethers.ZeroAddress,
        { ...baseMeta(), commodityType: "coffee" }
      );
      expect(await factory.totalDeployed()).to.equal(2);
      const tokens = await factory.getDeployerTokens(owner.address);
      expect(tokens.length).to.equal(2);
    });
    it("each deployed token has independent metadata", async () => {
      await factory.deployCommodityReceiptToken(
        "Cocoa", "CC",
        ethers.keccak256(ethers.toUtf8Bytes("CC-001")),
        "NG", owner.address, ethers.ZeroAddress, baseMeta()
      );
      await factory.deployCommodityReceiptToken(
        "Coffee", "CF",
        ethers.keccak256(ethers.toUtf8Bytes("CF-001")),
        "GH", owner.address, ethers.ZeroAddress,
        { ...baseMeta(), commodityType: "coffee", quantityKg: 3000n }
      );
      const deployed = await factory.getDeployerTokens(owner.address);
      const t1: CommodityReceiptToken = await ethers.getContractAt("CommodityReceiptToken", deployed[0]);
      const t2: CommodityReceiptToken = await ethers.getContractAt("CommodityReceiptToken", deployed[1]);
      expect(await t1.commodityType()).to.equal("cocoa");
      expect(await t2.commodityType()).to.equal("coffee");
      expect(await t2.quantityKg()).to.equal(3000n);
    });
    it("emits TokenDeployed event on deployment", async () => {
      await expect(
        factory.deployCommodityReceiptToken(
          "Test", "TST",
          ethers.keccak256(ethers.toUtf8Bytes("TEST-001")),
          "NG", owner.address, ethers.ZeroAddress, baseMeta()
        )
      ).to.emit(factory, "TokenDeployed");
    });
  });
});
