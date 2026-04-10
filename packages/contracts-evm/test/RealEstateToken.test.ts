import { expect } from "chai";
import { ethers } from "hardhat";
import { RealEstateToken, WhitelistVerifier, TokenFactory } from "../typechain-types";

describe("RealEstateToken", function () {
  let factory: TokenFactory;
  let impl: RealEstateToken;
  let verifier: WhitelistVerifier;
  let owner: any, investor: any, stranger: any;

  const assetId = ethers.keccak256(ethers.toUtf8Bytes("LAGOS-PROP-001"));
  const now = () => BigInt(Math.floor(Date.now() / 1000));

  const baseMeta = () => ({
    propertyId: "LG-REG-2024-0042",
    propertyType: "Residential",
    locationAddress: "15 Bourdillon Road, Ikoyi, Lagos",
    totalAreaSqMeters: 450n,
    titleDocumentHash: ethers.ZeroHash,
    valuationUSD: ethers.parseEther("500000"),
    rentalYieldBps: 600n,
    occupancyStatus: "Tenanted",
    developerAddress: ethers.ZeroAddress,
    lastUpdated: now(),
  });

  beforeEach(async () => {
    [owner, investor, stranger] = await ethers.getSigners();
    const WV = await ethers.getContractFactory("WhitelistVerifier");
    verifier = await WV.deploy(owner.address);
    const RT = await ethers.getContractFactory("RealEstateToken");
    impl = await RT.deploy();
    const TF = await ethers.getContractFactory("TokenFactory");
    factory = await TF.deploy(owner.address, owner.address);
    await factory.registerTemplate(2, await impl.getAddress());
  });

  async function deployToken(withVerifier = false): Promise<RealEstateToken> {
    const vAddr = withVerifier ? await verifier.getAddress() : ethers.ZeroAddress;
    const tx = await factory.deployRealEstateToken(
      "Lagos Ikoyi Token", "LIT", assetId, "NG",
      owner.address, vAddr, baseMeta()
    );
    await tx.wait();
    const tokens = await factory.getDeployerTokens(owner.address);
    return ethers.getContractAt("RealEstateToken", tokens[tokens.length - 1]);
  }

  describe("Deployment", () => {
    it("deploys with correct name and symbol", async () => {
      const t = await deployToken();
      expect(await t.name()).to.equal("Lagos Ikoyi Token");
      expect(await t.symbol()).to.equal("LIT");
    });
    it("sets country code to NG", async () => {
      const t = await deployToken();
      expect(await t.countryCode()).to.equal("NG");
    });
    it("starts in DRAFT status", async () => {
      const t = await deployToken();
      expect(await t.status()).to.equal(0);
    });
    it("stores metadata correctly", async () => {
      const t = await deployToken();
      const m = await t.getMetadata();
      expect(m.propertyId).to.equal("LG-REG-2024-0042");
      expect(m.propertyType).to.equal("Residential");
      expect(m.occupancyStatus).to.equal("Tenanted");
    });
    it("stores rental yield correctly", async () => {
      const t = await deployToken();
      expect(await t.rentalYieldBps()).to.equal(600n);
    });
    it("registers in factory", async () => {
      await deployToken();
      expect(await factory.totalDeployed()).to.equal(1);
    });
    it("sets metadata version to 1", async () => {
      const t = await deployToken();
      expect(await t.metadataVersion()).to.equal(1n);
    });
    it("grants all roles to admin", async () => {
      const t = await deployToken();
      expect(await t.hasRole(await t.MINTER_ROLE(), owner.address)).to.be.true;
      expect(await t.hasRole(await t.MANAGER_ROLE(), owner.address)).to.be.true;
    });
  });

  describe("Minting", () => {
    it("owner can mint", async () => {
      const t = await deployToken();
      await t.mint(investor.address, ethers.parseEther("1000"));
      expect(await t.balanceOf(investor.address)).to.equal(ethers.parseEther("1000"));
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
    it("manager can update valuation", async () => {
      const t = await deployToken();
      await t.updateValuation(ethers.parseEther("600000"));
      expect(await t.valuationUSD()).to.equal(ethers.parseEther("600000"));
    });
    it("increments version on valuation update", async () => {
      const t = await deployToken();
      await t.updateValuation(ethers.parseEther("600000"));
      expect(await t.metadataVersion()).to.equal(2n);
    });
    it("manager can update occupancy status", async () => {
      const t = await deployToken();
      await t.updateOccupancyStatus("Vacant");
      expect(await t.occupancyStatus()).to.equal("Vacant");
    });
    it("stranger cannot update metadata", async () => {
      const t = await deployToken();
      await expect(t.connect(stranger).updateValuation(100n)).to.be.reverted;
    });
    it("emits ValuationUpdated event", async () => {
      const t = await deployToken();
      await expect(t.updateValuation(ethers.parseEther("700000")))
        .to.emit(t, "ValuationUpdated");
    });
    it("emits OccupancyUpdated event", async () => {
      const t = await deployToken();
      await expect(t.updateOccupancyStatus("Vacant"))
        .to.emit(t, "OccupancyUpdated");
    });
  });

  describe("Rental Distribution", () => {
    it("manager can declare rental distribution", async () => {
      const t = await deployToken();
      await t.mint(investor.address, ethers.parseEther("1000"));
      await expect(t.declareRentalDistribution(ethers.parseEther("30000")))
        .to.emit(t, "RentalDeclared");
    });
    it("tracks total rental distributed", async () => {
      const t = await deployToken();
      await t.mint(investor.address, ethers.parseEther("1000"));
      const amount = ethers.parseEther("30000");
      await t.declareRentalDistribution(amount);
      expect(await t.totalRentalDistributed()).to.equal(amount);
    });
    it("reverts if no tokens in circulation", async () => {
      const t = await deployToken();
      await expect(
        t.declareRentalDistribution(ethers.parseEther("30000"))
      ).to.be.revertedWith("No tokens in circulation");
    });
    it("stranger cannot declare rental", async () => {
      const t = await deployToken();
      await t.mint(investor.address, ethers.parseEther("1000"));
      await expect(
        t.connect(stranger).declareRentalDistribution(ethers.parseEther("1000"))
      ).to.be.reverted;
    });
  });

  describe("Identity Verifier", () => {
    it("allows minting without verifier", async () => {
      const t = await deployToken(false);
      await expect(t.mint(investor.address, 100n)).to.not.be.reverted;
    });
    it("blocks minting to unverified when verifier set", async () => {
      const t = await deployToken(true);
      await expect(t.mint(investor.address, 100n)).to.be.reverted;
    });
    it("allows minting after verification", async () => {
      const t = await deployToken(true);
      await verifier.verifyIdentity(investor.address);
      await expect(t.mint(investor.address, 100n)).to.not.be.reverted;
    });
  });
});