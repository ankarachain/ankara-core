import { expect } from "chai";
import { ethers } from "hardhat";
import { MiningRightsToken, TokenFactory } from "../typechain-types";

describe("MiningRightsToken", function () {
  let factory: TokenFactory;
  let impl: MiningRightsToken;
  let owner: any, investor: any, stranger: any;

  const assetId = ethers.keccak256(ethers.toUtf8Bytes("ZM-COPPER-001"));
  const now = () => BigInt(Math.floor(Date.now() / 1000));
  const years = (n: number) => BigInt(n * 365 * 24 * 60 * 60);

  const baseMeta = () => ({
    licenseNumber: "ZM-MIN-2024-0042",
    mineralType: "Copper",
    concessionArea: "-13.1339, 27.8493",
    areaHectares: 500n,
    licenseExpiry: now() + years(5),
    issuingAuthority: "Zambia Mining Cadastre Office",
    licenseDocumentHash: ethers.ZeroHash,
    royaltyRateBps: 250n,
    lastUpdated: now(),
  });

  const expiredMeta = () => ({
    ...baseMeta(),
    licenseExpiry: now() - years(1),
  });

  beforeEach(async () => {
    [owner, investor, stranger] = await ethers.getSigners();
    const MR = await ethers.getContractFactory("MiningRightsToken");
    impl = await MR.deploy();
    const TF = await ethers.getContractFactory("TokenFactory");
    factory = await TF.deploy(owner.address, owner.address);
    await factory.registerTemplate(5, await impl.getAddress());
  });

  async function deployToken(expired = false): Promise<MiningRightsToken> {
    const meta = expired ? expiredMeta() : baseMeta();
    const tx = await factory.deployMiningRightsToken(
      "Zambia Copper Rights", "ZCR", assetId, "ZM",
      owner.address, ethers.ZeroAddress, meta
    );
    await tx.wait();
    const tokens = await factory.getDeployerTokens(owner.address);
    return ethers.getContractAt("MiningRightsToken", tokens[tokens.length - 1]);
  }

  describe("Deployment", () => {
    it("deploys with correct name and symbol", async () => {
      const t = await deployToken();
      expect(await t.name()).to.equal("Zambia Copper Rights");
      expect(await t.symbol()).to.equal("ZCR");
    });
    it("stores mineral type correctly", async () => {
      const t = await deployToken();
      expect(await t.mineralType()).to.equal("Copper");
    });
    it("stores area correctly", async () => {
      const t = await deployToken();
      expect(await t.areaHectares()).to.equal(500n);
    });
    it("stores royalty rate correctly", async () => {
      const t = await deployToken();
      expect(await t.royaltyRateBps()).to.equal(250n);
    });
    it("license is not expired on fresh deploy", async () => {
      const t = await deployToken();
      expect(await t.isLicenseExpired()).to.be.false;
    });
    it("days until expiry is positive on fresh deploy", async () => {
      const t = await deployToken();
      expect(await t.daysUntilExpiry()).to.be.greaterThan(0n);
    });
    it("country code is ZM", async () => {
      const t = await deployToken();
      expect(await t.countryCode()).to.equal("ZM");
    });
    it("starts with zero royalties declared", async () => {
      const t = await deployToken();
      expect(await t.totalRoyaltiesDeclared()).to.equal(0n);
    });
    it("sets metadata version to 1", async () => {
      const t = await deployToken();
      expect(await t.metadataVersion()).to.equal(1n);
    });
  });

  describe("License Expiry", () => {
    it("isLicenseExpired returns true for expired license", async () => {
      const t = await deployToken(true);
      expect(await t.isLicenseExpired()).to.be.true;
    });
    it("daysUntilExpiry is negative when expired", async () => {
      const t = await deployToken(true);
      expect(await t.daysUntilExpiry()).to.be.lessThan(0n);
    });
    it("manager can mark expired license as expired", async () => {
      const t = await deployToken(true);
      await t.markLicenseExpired();
      expect(await t.status()).to.equal(4);
    });
    it("cannot mark non-expired license as expired", async () => {
      const t = await deployToken(false);
      await expect(t.markLicenseExpired())
        .to.be.revertedWithCustomError(t, "LicenseAlreadyExpired");
    });
    it("emits LicenseExpired event", async () => {
      const t = await deployToken(true);
      await expect(t.markLicenseExpired()).to.emit(t, "LicenseExpired");
    });
  });

  describe("License Renewal", () => {
    it("manager can renew license", async () => {
      const t = await deployToken();
      const newExpiry = now() + years(10);
      await t.renewLicense(newExpiry);
      const meta = await t.getMetadata();
      expect(meta.licenseExpiry).to.equal(newExpiry);
    });
    it("increments version on renewal", async () => {
      const t = await deployToken();
      await t.renewLicense(now() + years(10));
      expect(await t.metadataVersion()).to.equal(2n);
    });
    it("emits LicenseRenewed event", async () => {
      const t = await deployToken();
      await expect(t.renewLicense(now() + years(10))).to.emit(t, "LicenseRenewed");
    });
    it("stranger cannot renew license", async () => {
      const t = await deployToken();
      await expect(t.connect(stranger).renewLicense(now() + years(10))).to.be.reverted;
    });
  });

  describe("Royalty Declaration", () => {
    it("manager can declare royalty", async () => {
      const t = await deployToken();
      await t.mint(investor.address, ethers.parseEther("1000"));
      await expect(t.declareRoyalty(ethers.parseEther("1000000")))
        .to.emit(t, "RoyaltyDeclared");
    });
    it("royalty calculated correctly at 250 bps", async () => {
      const t = await deployToken();
      await t.mint(investor.address, ethers.parseEther("1000"));
      await t.declareRoyalty(ethers.parseEther("1000000"));
      expect(await t.totalRoyaltiesDeclared()).to.equal(ethers.parseEther("25000"));
    });
    it("accumulates royalties across declarations", async () => {
      const t = await deployToken();
      await t.mint(investor.address, ethers.parseEther("1000"));
      await t.declareRoyalty(ethers.parseEther("1000000"));
      await t.declareRoyalty(ethers.parseEther("1000000"));
      expect(await t.totalRoyaltiesDeclared()).to.equal(ethers.parseEther("50000"));
    });
    it("reverts if no tokens in circulation", async () => {
      const t = await deployToken();
      await expect(t.declareRoyalty(ethers.parseEther("1000000")))
        .to.be.revertedWith("No tokens in circulation");
    });
    it("stranger cannot declare royalty", async () => {
      const t = await deployToken();
      await t.mint(investor.address, ethers.parseEther("1000"));
      await expect(t.connect(stranger).declareRoyalty(ethers.parseEther("1000000")))
        .to.be.reverted;
    });
  });

  describe("Minting", () => {
    it("owner can mint shares", async () => {
      const t = await deployToken();
      await t.mint(investor.address, ethers.parseEther("5000"));
      expect(await t.balanceOf(investor.address)).to.equal(ethers.parseEther("5000"));
    });
    it("stranger cannot mint", async () => {
      const t = await deployToken();
      await expect(t.connect(stranger).mint(investor.address, 100n)).to.be.reverted;
    });
    it("cannot mint when paused", async () => {
      const t = await deployToken();
      await t.pause();
      await expect(t.mint(investor.address, 100n)).to.be.reverted;
    });
  });

  describe("Metadata Updates", () => {
    it("manager can update metadata", async () => {
      const t = await deployToken();
      const newMeta = { ...baseMeta(), mineralType: "Gold" };
      await t.updateMetadata(newMeta);
      expect(await t.mineralType()).to.equal("Gold");
    });
    it("increments version on update", async () => {
      const t = await deployToken();
      await t.updateMetadata(baseMeta());
      expect(await t.metadataVersion()).to.equal(2n);
    });
    it("stranger cannot update", async () => {
      const t = await deployToken();
      await expect(t.connect(stranger).updateMetadata(baseMeta())).to.be.reverted;
    });
    it("emits MetadataUpdated event", async () => {
      const t = await deployToken();
      await expect(t.updateMetadata(baseMeta())).to.emit(t, "MetadataUpdated");
    });
  });
});
