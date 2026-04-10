import { expect } from "chai";
import { ethers } from "hardhat";
import { CarbonCreditToken, TokenFactory } from "../typechain-types";

describe("CarbonCreditToken", function () {
  let factory: TokenFactory;
  let impl: CarbonCreditToken;
  let owner: any, investor: any, stranger: any;

  const assetId = ethers.keccak256(ethers.toUtf8Bytes("DRC-REDD-001"));
  const now = () => BigInt(Math.floor(Date.now() / 1000));

  const baseMeta = () => ({
    creditType: "REDD+",
    verificationBodyRef: "VERRA-VCS-2024-001",
    vintageYear: 2024n,
    quantityCO2e: ethers.parseEther("10000"),
    projectLocation: "-4.0383, 21.7587",
    projectType: "Forestry",
    verificationDocHash: ethers.ZeroHash,
    lastUpdated: now(),
  });

  beforeEach(async () => {
    [owner, investor, stranger] = await ethers.getSigners();
    const CC = await ethers.getContractFactory("CarbonCreditToken");
    impl = await CC.deploy();
    const TF = await ethers.getContractFactory("TokenFactory");
    factory = await TF.deploy(owner.address, owner.address);
    await factory.registerTemplate(4, await impl.getAddress());
  });

  async function deployToken(): Promise<CarbonCreditToken> {
    const tx = await factory.deployCarbonCreditToken(
      "DRC Forest Credit", "DRCC", assetId, "CD",
      owner.address, ethers.ZeroAddress, baseMeta()
    );
    await tx.wait();
    const tokens = await factory.getDeployerTokens(owner.address);
    return ethers.getContractAt("CarbonCreditToken", tokens[tokens.length - 1]);
  }

  describe("Deployment", () => {
    it("deploys with correct name and symbol", async () => {
      const t = await deployToken();
      expect(await t.name()).to.equal("DRC Forest Credit");
      expect(await t.symbol()).to.equal("DRCC");
    });
    it("stores credit type correctly", async () => {
      const t = await deployToken();
      expect(await t.creditType()).to.equal("REDD+");
    });
    it("stores vintage year correctly", async () => {
      const t = await deployToken();
      expect(await t.vintageYear()).to.equal(2024n);
    });
    it("stores quantity correctly", async () => {
      const t = await deployToken();
      expect(await t.quantityCO2e()).to.equal(ethers.parseEther("10000"));
    });
    it("starts with zero total retired", async () => {
      const t = await deployToken();
      expect(await t.totalRetired()).to.equal(0n);
    });
    it("starts with zero retirements count", async () => {
      const t = await deployToken();
      expect(await t.totalRetirements()).to.equal(0n);
    });
    it("country code is CD", async () => {
      const t = await deployToken();
      expect(await t.countryCode()).to.equal("CD");
    });
    it("sets metadata version to 1", async () => {
      const t = await deployToken();
      expect(await t.metadataVersion()).to.equal(1n);
    });
  });

  describe("Minting", () => {
    it("owner can mint credits", async () => {
      const t = await deployToken();
      await t.mint(investor.address, ethers.parseEther("500"));
      expect(await t.balanceOf(investor.address)).to.equal(ethers.parseEther("500"));
    });
    it("stranger cannot mint", async () => {
      const t = await deployToken();
      await expect(t.connect(stranger).mint(investor.address, 100n)).to.be.reverted;
    });
  });

  describe("Credit Retirement", () => {
    let token: CarbonCreditToken;
    beforeEach(async () => {
      token = await deployToken();
      await token.mint(investor.address, ethers.parseEther("1000"));
    });

    it("investor can retire their credits", async () => {
      await token.connect(investor).retire(ethers.parseEther("100"), "Acme Corp", "Q1 2026");
      expect(await token.totalRetired()).to.equal(ethers.parseEther("100"));
    });
    it("retirement burns the tokens", async () => {
      const before = await token.balanceOf(investor.address);
      await token.connect(investor).retire(ethers.parseEther("100"), "Acme Corp", "Annual");
      const after = await token.balanceOf(investor.address);
      expect(before - after).to.equal(ethers.parseEther("100"));
    });
    it("records retirement details correctly", async () => {
      await token.connect(investor).retire(ethers.parseEther("50"), "Test Beneficiary", "Test note");
      const record = await token.getRetirement(0);
      expect(record.retiredBy).to.equal(investor.address);
      expect(record.amount).to.equal(ethers.parseEther("50"));
      expect(record.beneficiary).to.equal("Test Beneficiary");
      expect(record.retirementNote).to.equal("Test note");
    });
    it("increments retirement count", async () => {
      await token.connect(investor).retire(ethers.parseEther("10"), "Corp A", "note");
      await token.connect(investor).retire(ethers.parseEther("10"), "Corp B", "note");
      expect(await token.totalRetirements()).to.equal(2n);
    });
    it("reverts on zero retirement amount", async () => {
      await expect(
        token.connect(investor).retire(0n, "Corp", "note")
      ).to.be.revertedWithCustomError(token, "ZeroRetirementAmount");
    });
    it("reverts when retiring more than balance", async () => {
      await expect(
        token.connect(investor).retire(ethers.parseEther("9999"), "Corp", "note")
      ).to.be.revertedWithCustomError(token, "InsufficientBalance");
    });
    it("emits CreditsRetired event", async () => {
      await expect(
        token.connect(investor).retire(ethers.parseEther("100"), "Acme Corp", "Q1 offset")
      ).to.emit(token, "CreditsRetired");
    });
    it("stranger with no balance cannot retire", async () => {
      await expect(
        token.connect(stranger).retire(ethers.parseEther("1"), "Corp", "note")
      ).to.be.revertedWithCustomError(token, "InsufficientBalance");
    });
    it("total retired accumulates across multiple retirements", async () => {
      await token.connect(investor).retire(ethers.parseEther("100"), "A", "n");
      await token.connect(investor).retire(ethers.parseEther("200"), "B", "n");
      expect(await token.totalRetired()).to.equal(ethers.parseEther("300"));
    });
    it("can retire full balance", async () => {
      const balance = await token.balanceOf(investor.address);
      await expect(
        token.connect(investor).retire(balance, "Full offset", "Complete retirement")
      ).to.not.be.reverted;
      expect(await token.balanceOf(investor.address)).to.equal(0n);
    });
  });

  describe("Metadata Updates", () => {
    it("manager can update metadata", async () => {
      const t = await deployToken();
      const newMeta = { ...baseMeta(), creditType: "Gold Standard" };
      await t.updateMetadata(newMeta);
      expect(await t.creditType()).to.equal("Gold Standard");
    });
    it("increments version on update", async () => {
      const t = await deployToken();
      await t.updateMetadata(baseMeta());
      expect(await t.metadataVersion()).to.equal(2n);
    });
    it("stranger cannot update metadata", async () => {
      const t = await deployToken();
      await expect(t.connect(stranger).updateMetadata(baseMeta())).to.be.reverted;
    });
    it("emits MetadataUpdated event", async () => {
      const t = await deployToken();
      await expect(t.updateMetadata(baseMeta())).to.emit(t, "MetadataUpdated");
    });
  });
});
