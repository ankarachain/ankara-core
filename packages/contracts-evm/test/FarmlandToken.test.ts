import { expect } from "chai";
import { ethers } from "hardhat";
import { FarmlandToken, WhitelistVerifier, TokenFactory } from "../typechain-types";

describe("FarmlandToken", function () {
  let factory: TokenFactory;
  let farmlandImpl: FarmlandToken;
  let verifier: WhitelistVerifier;
  let owner: any, investor: any, stranger: any;

  const assetId = ethers.keccak256(ethers.toUtf8Bytes("TEST-FARM-001"));
  const now = () => Math.floor(Date.now() / 1000);

  const baseMetadata = () => ({
    location: "12.0022, 8.5919",
    areaSqMeters: 50000n,
    soilType: "loam",
    irrigationType: "rain-fed",
    cropHistory: "maize,sorghum,fallow",
    titleDocumentHash: ethers.ZeroHash,
    valuationUSD: ethers.parseEther("125000"),
    stateRegion: "Kano State",
    lastUpdated: BigInt(now()),
  });

  beforeEach(async function () {
    [owner, investor, stranger] = await ethers.getSigners();

    // Deploy verifier
    const WV = await ethers.getContractFactory("WhitelistVerifier");
    verifier = await WV.deploy(owner.address);

    // Deploy implementation
    const FT = await ethers.getContractFactory("FarmlandToken");
    farmlandImpl = await FT.deploy();

    // Deploy factory
    const TF = await ethers.getContractFactory("TokenFactory");
    factory = await TF.deploy(owner.address, owner.address);

    // Register template
    await factory.registerTemplate(0, await farmlandImpl.getAddress());
  });

  async function deployToken(withVerifier = false): Promise<FarmlandToken> {
    const verifierAddr = withVerifier
      ? await verifier.getAddress()
      : ethers.ZeroAddress;

    const tx = await factory.deployFarmlandToken(
      "Kano Farmland Token", "KFT",
      assetId, "NG",
      owner.address, verifierAddr,
      baseMetadata()
    );
    await tx.wait();

    const tokens = await factory.getDeployerTokens(owner.address);
    return ethers.getContractAt("FarmlandToken", tokens[tokens.length - 1]);
  }

  // ─── Deployment ───────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("deploys with correct name and symbol", async function () {
      const token = await deployToken();
      expect(await token.name()).to.equal("Kano Farmland Token");
      expect(await token.symbol()).to.equal("KFT");
    });

    it("sets country code correctly", async function () {
      const token = await deployToken();
      expect(await token.countryCode()).to.equal("NG");
    });

    it("starts in DRAFT status", async function () {
      const token = await deployToken();
      expect(await token.status()).to.equal(0); // AssetStatus.DRAFT
    });

    it("stores metadata correctly", async function () {
      const token = await deployToken();
      const meta = await token.getMetadata();
      expect(meta.location).to.equal("12.0022, 8.5919");
      expect(meta.areaSqMeters).to.equal(50000n);
      expect(meta.soilType).to.equal("loam");
      expect(meta.countryCode).to.be.undefined; // countryCode is on base token
    });

    it("grants all roles to admin", async function () {
      const token = await deployToken();
      const MINTER = await token.MINTER_ROLE();
      const MANAGER = await token.MANAGER_ROLE();
      expect(await token.hasRole(MINTER, owner.address)).to.be.true;
      expect(await token.hasRole(MANAGER, owner.address)).to.be.true;
    });

    it("registers in factory", async function () {
      await deployToken();
      expect(await factory.totalDeployed()).to.equal(1);
    });
  });

  // ─── Minting ──────────────────────────────────────────────────────────

  describe("Minting", function () {
    it("owner can mint tokens", async function () {
      const token = await deployToken();
      await token.mint(investor.address, ethers.parseEther("1000"));
      expect(await token.balanceOf(investor.address)).to.equal(ethers.parseEther("1000"));
    });

    it("stranger cannot mint", async function () {
      const token = await deployToken();
      await expect(
        token.connect(stranger).mint(investor.address, ethers.parseEther("100"))
      ).to.be.reverted;
    });

    it("cannot mint when paused", async function () {
      const token = await deployToken();
      await token.pause();
      await expect(
        token.mint(investor.address, ethers.parseEther("100"))
      ).to.be.reverted;
    });
  });

  // ─── Identity Verifier ────────────────────────────────────────────────

  describe("Identity Verifier", function () {
    it("allows minting without verifier set", async function () {
      const token = await deployToken(false); // no KYC
      await expect(token.mint(investor.address, 100n)).to.not.be.reverted;
    });

    it("blocks minting to unverified address when verifier is set", async function () {
      const token = await deployToken(true); // with KYC
      await expect(token.mint(investor.address, 100n)).to.be.reverted;
    });

    it("allows minting after verifying address", async function () {
      const token = await deployToken(true);
      await verifier.verifyIdentity(investor.address);
      await expect(token.mint(investor.address, 100n)).to.not.be.reverted;
    });

    it("blocks transfer from unverified address", async function () {
      const token = await deployToken(true);
      await verifier.verifyIdentity(investor.address);
      await token.mint(investor.address, 100n);

      // Revoke investor — should now block transfer
      await verifier.revokeIdentity(investor.address);
      await expect(
        token.connect(investor).transfer(stranger.address, 50n)
      ).to.be.reverted;
    });

    it("owner can swap identity verifier", async function () {
      const token = await deployToken(true);
      const newVerifierAddr = ethers.ZeroAddress; // disable KYC
      await token.setIdentityVerifier(newVerifierAddr);
      expect(await token.identityVerifier()).to.equal(newVerifierAddr);
    });
  });

  // ─── Asset Status ─────────────────────────────────────────────────────

  describe("Asset Status", function () {
    it("manager can update status", async function () {
      const token = await deployToken();
      await token.setStatus(1); // ACTIVE
      expect(await token.status()).to.equal(1);
    });

    it("stranger cannot update status", async function () {
      const token = await deployToken();
      await expect(token.connect(stranger).setStatus(1)).to.be.reverted;
    });
  });

  // ─── Metadata Updates ─────────────────────────────────────────────────

  describe("Metadata Updates", function () {
    it("increments version on update", async function () {
      const token = await deployToken();
      expect(await token.metadataVersion()).to.equal(1);
      await token.updateValuation(ethers.parseEther("150000"));
      expect(await token.metadataVersion()).to.equal(2);
    });

    it("updates valuation correctly", async function () {
      const token = await deployToken();
      const newVal = ethers.parseEther("200000");
      await token.updateValuation(newVal);
      expect(await token.valuationUSD()).to.equal(newVal);
    });

    it("stranger cannot update metadata", async function () {
      const token = await deployToken();
      await expect(
        token.connect(stranger).updateValuation(100n)
      ).to.be.reverted;
    });
  });
});
