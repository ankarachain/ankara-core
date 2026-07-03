import { expect } from "chai";
import { ethers } from "hardhat";
import type {
  TokenFactory,
  FarmlandToken,
  CommodityReceiptToken,
  RealEstateToken,
  InvoiceToken,
  CarbonCreditToken,
  MiningRightsToken,
} from "../typechain-types";

describe("TokenFactory", function () {
  let factory: TokenFactory;
  let owner: any, deployer: any, stranger: any;

  let farmlandImpl:   FarmlandToken;
  let commodityImpl:  CommodityReceiptToken;
  let realEstateImpl: RealEstateToken;
  let invoiceImpl:    InvoiceToken;
  let carbonImpl:     CarbonCreditToken;
  let miningImpl:     MiningRightsToken;

  const TMPL = {
    FARMLAND:         0,
    COMMODITY_RECEIPT: 1,
    REAL_ESTATE:      2,
    INVOICE:          3,
    CARBON_CREDIT:    4,
    MINING_RIGHTS:    5,
  };

  const now = () => BigInt(Math.floor(Date.now() / 1000));
  const days = (n: number) => BigInt(n * 24 * 60 * 60);

  beforeEach(async function () {
    [owner, deployer, stranger] = await ethers.getSigners();

    farmlandImpl   = await (await ethers.getContractFactory("FarmlandToken")).deploy();
    commodityImpl  = await (await ethers.getContractFactory("CommodityReceiptToken")).deploy();
    realEstateImpl = await (await ethers.getContractFactory("RealEstateToken")).deploy();
    invoiceImpl    = await (await ethers.getContractFactory("InvoiceToken")).deploy();
    carbonImpl     = await (await ethers.getContractFactory("CarbonCreditToken")).deploy();
    miningImpl     = await (await ethers.getContractFactory("MiningRightsToken")).deploy();

    factory = await (await ethers.getContractFactory("TokenFactory"))
      .deploy(owner.address, owner.address);
  });

  // ─── Helpers ──────────────────────────────────────────────────────────────

  async function registerAll() {
    await factory.registerTemplate(TMPL.FARMLAND,          await farmlandImpl.getAddress());
    await factory.registerTemplate(TMPL.COMMODITY_RECEIPT, await commodityImpl.getAddress());
    await factory.registerTemplate(TMPL.REAL_ESTATE,       await realEstateImpl.getAddress());
    await factory.registerTemplate(TMPL.INVOICE,           await invoiceImpl.getAddress());
    await factory.registerTemplate(TMPL.CARBON_CREDIT,     await carbonImpl.getAddress());
    await factory.registerTemplate(TMPL.MINING_RIGHTS,     await miningImpl.getAddress());
  }

  const farmMeta = () => ({
    location: "12.0022, 8.5919", areaSqMeters: 50000n, soilType: "loam",
    irrigationType: "rain-fed", cropHistory: "maize,sorghum",
    titleDocumentHash: ethers.ZeroHash, valuationUSD: ethers.parseEther("125000"),
    stateRegion: "Kano State", lastUpdated: now(),
  });

  const commodityMeta = () => ({
    commodityType: "cocoa", quantityKg: 5000n, gradeClassification: "Grade A",
    warehouseId: "WH-001", warehouseLocation: "Lagos",
    depositDate: now(), expiryDate: now() + days(365),
    inspectionReportHash: ethers.ZeroHash, valuationUSD: ethers.parseEther("25000"),
    harvestSeason: "2025/2026", lastUpdated: now(),
  });

  const realEstateMeta = () => ({
    propertyId: "PROP-001", propertyType: "Residential",
    locationAddress: "Victoria Island, Lagos", totalAreaSqMeters: 500n,
    titleDocumentHash: ethers.ZeroHash, valuationUSD: ethers.parseEther("500000"),
    rentalYieldBps: 600n, occupancyStatus: "Vacant",
    developerAddress: owner.address, lastUpdated: now(),
  });

  const invoiceMeta = () => ({
    invoiceNumber: "INV-001", debtorReference: "DEBTOR-001",
    faceValueUSD: ethers.parseEther("50000"), discountRateBps: 500n,
    issuanceDate: now(), dueDate: now() + days(90),
    invoiceDocumentHash: ethers.ZeroHash, currency: "NGN", lastUpdated: now(),
  });

  const carbonMeta = () => ({
    creditType: "REDD+", verificationBodyRef: "VERRA-VCS-2024-001",
    vintageYear: 2024n, quantityCO2e: ethers.parseEther("10000"),
    projectLocation: "-4.0383, 21.7587", projectType: "Forestry",
    verificationDocHash: ethers.ZeroHash, lastUpdated: now(),
  });

  const miningMeta = () => ({
    licenseNumber: "ZM-MIN-2024-0042", mineralType: "Copper",
    concessionArea: "-13.1339, 27.8493", areaHectares: 500n,
    licenseExpiry: now() + days(365 * 5),
    issuingAuthority: "Zambia Mining Cadastre Office",
    licenseDocumentHash: ethers.ZeroHash, royaltyRateBps: 250n, lastUpdated: now(),
  });

  // ─── Constructor ──────────────────────────────────────────────────────────

  describe("Constructor", function () {
    it("sets owner correctly", async function () {
      expect(await factory.owner()).to.equal(owner.address);
    });

    it("sets fee recipient correctly", async function () {
      expect(await factory.feeRecipient()).to.equal(owner.address);
    });

    it("starts with zero deployment fee", async function () {
      expect(await factory.deploymentFee()).to.equal(0n);
    });

    it("starts with zero deployments", async function () {
      expect(await factory.totalDeployed()).to.equal(0n);
    });

    it("reverts if fee recipient is zero address", async function () {
      const TF = await ethers.getContractFactory("TokenFactory");
      await expect(TF.deploy(owner.address, ethers.ZeroAddress)).to.be.reverted;
    });
  });

  // ─── Template Registration ────────────────────────────────────────────────

  describe("Template Registration", function () {
    it("owner can register a template", async function () {
      await factory.registerTemplate(TMPL.FARMLAND, await farmlandImpl.getAddress());
      expect(await factory.implementations(TMPL.FARMLAND))
        .to.equal(await farmlandImpl.getAddress());
    });

    it("emits TemplateRegistered", async function () {
      const addr = await farmlandImpl.getAddress();
      await expect(factory.registerTemplate(TMPL.FARMLAND, addr))
        .to.emit(factory, "TemplateRegistered")
        .withArgs(TMPL.FARMLAND, addr);
    });

    it("stranger cannot register a template", async function () {
      await expect(
        factory.connect(stranger).registerTemplate(TMPL.FARMLAND, await farmlandImpl.getAddress())
      ).to.be.reverted;
    });

    it("reverts on zero implementation address", async function () {
      await expect(factory.registerTemplate(TMPL.FARMLAND, ethers.ZeroAddress)).to.be.reverted;
    });

    it("can register all 6 templates", async function () {
      await registerAll();
      for (let i = 0; i < 6; i++) {
        expect(await factory.implementations(i)).to.not.equal(ethers.ZeroAddress);
      }
    });
  });

  // ─── deployFarmlandToken ──────────────────────────────────────────────────

  describe("deployFarmlandToken", function () {
    beforeEach(() => factory.registerTemplate(TMPL.FARMLAND, farmlandImpl.getAddress()));

    it("deploys a new proxy and increments totalDeployed", async function () {
      await factory.deployFarmlandToken(
        "Kano Farm", "KFT",
        ethers.keccak256(ethers.toUtf8Bytes("FARM-001")), "NG",
        owner.address, ethers.ZeroAddress, farmMeta()
      );
      expect(await factory.totalDeployed()).to.equal(1n);
    });

    it("emits TokenDeployed event", async function () {
      const assetId = ethers.keccak256(ethers.toUtf8Bytes("FARM-002"));
      await expect(factory.deployFarmlandToken(
        "Kano Farm", "KFT", assetId, "NG",
        owner.address, ethers.ZeroAddress, farmMeta()
      )).to.emit(factory, "TokenDeployed");
    });

    it("reverts if farmland template not registered", async function () {
      const unregisteredFactory = await (await ethers.getContractFactory("TokenFactory"))
        .deploy(owner.address, owner.address);
      await expect(unregisteredFactory.deployFarmlandToken(
        "F", "F", ethers.ZeroHash, "NG",
        owner.address, ethers.ZeroAddress, farmMeta()
      )).to.be.reverted;
    });
  });

  // ─── deployCommodityReceiptToken ──────────────────────────────────────────

  describe("deployCommodityReceiptToken", function () {
    beforeEach(() => factory.registerTemplate(TMPL.COMMODITY_RECEIPT, commodityImpl.getAddress()));

    it("deploys commodity token", async function () {
      await factory.deployCommodityReceiptToken(
        "Lagos Cocoa", "LCC",
        ethers.keccak256(ethers.toUtf8Bytes("COCOA-001")), "NG",
        owner.address, ethers.ZeroAddress, commodityMeta()
      );
      expect(await factory.totalDeployed()).to.equal(1n);
    });
  });

  // ─── deployRealEstateToken ────────────────────────────────────────────────

  describe("deployRealEstateToken", function () {
    beforeEach(() => factory.registerTemplate(TMPL.REAL_ESTATE, realEstateImpl.getAddress()));

    it("deploys real estate token", async function () {
      await factory.deployRealEstateToken(
        "Lagos Property", "LPT",
        ethers.keccak256(ethers.toUtf8Bytes("PROP-001")), "NG",
        owner.address, ethers.ZeroAddress, realEstateMeta()
      );
      expect(await factory.totalDeployed()).to.equal(1n);
    });
  });

  // ─── deployInvoiceToken ───────────────────────────────────────────────────

  describe("deployInvoiceToken", function () {
    beforeEach(() => factory.registerTemplate(TMPL.INVOICE, invoiceImpl.getAddress()));

    it("deploys invoice token", async function () {
      await factory.deployInvoiceToken(
        "SME Invoice", "SIT",
        ethers.keccak256(ethers.toUtf8Bytes("INV-001")), "NG",
        owner.address, ethers.ZeroAddress, invoiceMeta()
      );
      expect(await factory.totalDeployed()).to.equal(1n);
    });

    it("deployed token starts in PENDING invoice status", async function () {
      const assetId = ethers.keccak256(ethers.toUtf8Bytes("INV-002"));
      await factory.deployInvoiceToken(
        "SME Invoice", "SIT", assetId, "NG",
        owner.address, ethers.ZeroAddress, invoiceMeta()
      );
      const tokens = await factory.getDeployerTokens(owner.address);
      const token  = await ethers.getContractAt("InvoiceToken", tokens[0]);
      expect(await token.invoiceStatus()).to.equal(0); // PENDING
    });
  });

  // ─── deployCarbonCreditToken ──────────────────────────────────────────────

  describe("deployCarbonCreditToken", function () {
    beforeEach(() => factory.registerTemplate(TMPL.CARBON_CREDIT, carbonImpl.getAddress()));

    it("deploys carbon credit token", async function () {
      await factory.deployCarbonCreditToken(
        "DRC Forest Credits", "DRCC",
        ethers.keccak256(ethers.toUtf8Bytes("REDD-001")), "CD",
        owner.address, ethers.ZeroAddress, carbonMeta()
      );
      expect(await factory.totalDeployed()).to.equal(1n);
    });

    it("deployed token starts with zero total retired", async function () {
      const assetId = ethers.keccak256(ethers.toUtf8Bytes("REDD-002"));
      await factory.deployCarbonCreditToken(
        "DRC Credits", "DRCC", assetId, "CD",
        owner.address, ethers.ZeroAddress, carbonMeta()
      );
      const tokens = await factory.getDeployerTokens(owner.address);
      const token  = await ethers.getContractAt("CarbonCreditToken", tokens[0]);
      expect(await token.totalRetired()).to.equal(0n);
    });
  });

  // ─── deployMiningRightsToken ──────────────────────────────────────────────

  describe("deployMiningRightsToken", function () {
    beforeEach(() => factory.registerTemplate(TMPL.MINING_RIGHTS, miningImpl.getAddress()));

    it("deploys mining rights token", async function () {
      await factory.deployMiningRightsToken(
        "Zambia Copper", "ZCR",
        ethers.keccak256(ethers.toUtf8Bytes("MINE-001")), "ZM",
        owner.address, ethers.ZeroAddress, miningMeta()
      );
      expect(await factory.totalDeployed()).to.equal(1n);
    });
  });

  // ─── Registry ─────────────────────────────────────────────────────────────

  describe("Registry", function () {
    beforeEach(registerAll);

    it("tracks deployments across multiple templates", async function () {
      await factory.deployFarmlandToken(
        "F1", "F1", ethers.keccak256(ethers.toUtf8Bytes("A")), "NG",
        owner.address, ethers.ZeroAddress, farmMeta()
      );
      await factory.deployCarbonCreditToken(
        "C1", "C1", ethers.keccak256(ethers.toUtf8Bytes("B")), "CD",
        owner.address, ethers.ZeroAddress, carbonMeta()
      );
      await factory.deployMiningRightsToken(
        "M1", "M1", ethers.keccak256(ethers.toUtf8Bytes("C")), "ZM",
        owner.address, ethers.ZeroAddress, miningMeta()
      );
      expect(await factory.totalDeployed()).to.equal(3n);
    });

    it("tracks tokens by deployer address", async function () {
      await factory.connect(deployer).deployFarmlandToken(
        "F1", "F1", ethers.keccak256(ethers.toUtf8Bytes("DEPLOYER-A")), "NG",
        deployer.address, ethers.ZeroAddress, farmMeta()
      );
      const deployerTokens = await factory.getDeployerTokens(deployer.address);
      const ownerTokens    = await factory.getDeployerTokens(owner.address);
      expect(deployerTokens.length).to.equal(1);
      expect(ownerTokens.length).to.equal(0);
    });

    it("deployed token address is non-zero and has correct name", async function () {
      const assetId = ethers.keccak256(ethers.toUtf8Bytes("ADDR-CHECK"));
      await factory.deployFarmlandToken(
        "Verified Farm", "VF", assetId, "NG",
        owner.address, ethers.ZeroAddress, farmMeta()
      );
      const tokens = await factory.getDeployerTokens(owner.address);
      expect(tokens[0]).to.not.equal(ethers.ZeroAddress);
      const token = await ethers.getContractAt("FarmlandToken", tokens[0]);
      expect(await token.name()).to.equal("Verified Farm");
    });

    it("each deployer sees only their own tokens", async function () {
      await factory.connect(owner).deployFarmlandToken(
        "Owner Farm", "OF", ethers.keccak256(ethers.toUtf8Bytes("OWN")), "NG",
        owner.address, ethers.ZeroAddress, farmMeta()
      );
      await factory.connect(deployer).deployRealEstateToken(
        "Deployer Property", "DP", ethers.keccak256(ethers.toUtf8Bytes("DEP")), "NG",
        deployer.address, ethers.ZeroAddress, realEstateMeta()
      );

      expect((await factory.getDeployerTokens(owner.address)).length).to.equal(1);
      expect((await factory.getDeployerTokens(deployer.address)).length).to.equal(1);
    });
  });

  // ─── Fee Management ───────────────────────────────────────────────────────

  describe("Fee Management", function () {
    it("owner can set deployment fee", async function () {
      const fee = ethers.parseEther("0.001");
      await expect(factory.setDeploymentFee(fee))
        .to.emit(factory, "DeploymentFeeUpdated")
        .withArgs(0n, fee);
      expect(await factory.deploymentFee()).to.equal(fee);
    });

    it("stranger cannot set deployment fee", async function () {
      await expect(factory.connect(stranger).setDeploymentFee(100n)).to.be.reverted;
    });

    it("owner can set fee recipient", async function () {
      await expect(factory.setFeeRecipient(deployer.address))
        .to.emit(factory, "FeeRecipientUpdated")
        .withArgs(owner.address, deployer.address);
      expect(await factory.feeRecipient()).to.equal(deployer.address);
    });

    it("reverts setting zero-address fee recipient", async function () {
      await expect(factory.setFeeRecipient(ethers.ZeroAddress)).to.be.reverted;
    });

    it("stranger cannot set fee recipient", async function () {
      await expect(factory.connect(stranger).setFeeRecipient(stranger.address)).to.be.reverted;
    });

    it("collects fee on deployment; owner can withdraw", async function () {
      await factory.registerTemplate(TMPL.FARMLAND, await farmlandImpl.getAddress());
      const fee = ethers.parseEther("0.01");
      await factory.setDeploymentFee(fee);

      await factory.connect(deployer).deployFarmlandToken(
        "F", "F", ethers.keccak256(ethers.toUtf8Bytes("FEE")), "NG",
        deployer.address, ethers.ZeroAddress, farmMeta(),
        { value: fee }
      );

      const factoryAddr = await factory.getAddress();
      expect(await ethers.provider.getBalance(factoryAddr)).to.equal(fee);

      await factory.withdrawFees();
      expect(await ethers.provider.getBalance(factoryAddr)).to.equal(0n);
    });

    it("reverts deployment when fee is insufficient", async function () {
      await factory.registerTemplate(TMPL.FARMLAND, await farmlandImpl.getAddress());
      await factory.setDeploymentFee(ethers.parseEther("0.01"));

      await expect(factory.deployFarmlandToken(
        "F", "F", ethers.keccak256(ethers.toUtf8Bytes("LOW")), "NG",
        owner.address, ethers.ZeroAddress, farmMeta(),
        { value: 0n }
      )).to.be.reverted;
    });
  });
});
