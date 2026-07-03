import { expect } from "chai";
import { ethers } from "hardhat";
import type { MultiTokenFactory, CommodityBatchToken, PoolVault } from "../typechain-types";

describe("MultiTokenFactory", function () {
  let factory: MultiTokenFactory;
  let commodityBatchImpl: any;
  let poolVaultImpl: any;
  let owner: any, deployer: any, stranger: any;

  const TMPL = {
    COMMODITY_BATCH: 0,
    POOL_VAULT:      1,
  };

  const warehouseMeta = () => ({
    warehouseId:          "WH-LAG-001",
    warehouseLocation:    "Apapa, Lagos, Nigeria",
    operatorAddress:      ethers.ZeroAddress,
    warehouseLicenseHash: ethers.ZeroHash,
    certificationExpiry:  BigInt(9_999_999_999),
  });

  const ASSET_ID = ethers.keccak256(ethers.toUtf8Bytes("POOL-001"));

  beforeEach(async function () {
    [owner, deployer, stranger] = await ethers.getSigners();

    commodityBatchImpl = await (await ethers.getContractFactory("CommodityBatchToken")).deploy();
    poolVaultImpl      = await (await ethers.getContractFactory("PoolVault")).deploy();

    factory = await (await ethers.getContractFactory("MultiTokenFactory"))
      .deploy(owner.address, owner.address) as MultiTokenFactory;
  });

  // ─── Helpers ──────────────────────────────────────────────────────────────

  async function registerAll() {
    await factory.registerTemplate(TMPL.COMMODITY_BATCH, await commodityBatchImpl.getAddress());
    await factory.registerTemplate(TMPL.POOL_VAULT,      await poolVaultImpl.getAddress());
  }

  const deployCommodityBatch = (caller = owner) =>
    factory.connect(caller).deployCommodityBatchToken(
      "Lagos Cocoa Warehouse", "NG", "ipfs://QmWarehouse/",
      caller.address, warehouseMeta()
    );

  const deployPool = (caller = owner) =>
    factory.connect(caller).deployPoolVault(
      "West Africa Pool", "WACP",
      ASSET_ID, "NG",
      caller.address, ethers.ZeroAddress,
      ethers.ZeroAddress, // no oracle for factory test
      50n
    );

  // ─── Deployment ───────────────────────────────────────────────────────────

  describe("deployment", function () {
    it("sets owner correctly", async function () {
      expect(await factory.owner()).to.equal(owner.address);
    });

    it("sets feeRecipient correctly", async function () {
      expect(await factory.feeRecipient()).to.equal(owner.address);
    });

    it("deploymentFee starts at 0", async function () {
      expect(await factory.deploymentFee()).to.equal(0n);
    });

    it("reverts constructor with zero-address feeRecipient", async function () {
      await expect(
        (await ethers.getContractFactory("MultiTokenFactory"))
          .deploy(owner.address, ethers.ZeroAddress)
      ).to.be.reverted;
    });
  });

  // ─── registerTemplate ─────────────────────────────────────────────────────

  describe("registerTemplate", function () {
    it("owner can register both templates", async function () {
      await registerAll();
      expect(await factory.implementations(TMPL.COMMODITY_BATCH))
        .to.equal(await commodityBatchImpl.getAddress());
      expect(await factory.implementations(TMPL.POOL_VAULT))
        .to.equal(await poolVaultImpl.getAddress());
    });

    it("emits MultiTokenTemplateRegistered event", async function () {
      const addr = await commodityBatchImpl.getAddress();
      await expect(factory.registerTemplate(TMPL.COMMODITY_BATCH, addr))
        .to.emit(factory, "MultiTokenTemplateRegistered")
        .withArgs(TMPL.COMMODITY_BATCH, addr);
    });

    it("reverts on zero-address implementation", async function () {
      await expect(factory.registerTemplate(TMPL.COMMODITY_BATCH, ethers.ZeroAddress))
        .to.be.reverted;
    });

    it("stranger cannot register template", async function () {
      await expect(
        factory.connect(stranger).registerTemplate(TMPL.COMMODITY_BATCH, await commodityBatchImpl.getAddress())
      ).to.be.reverted;
    });
  });

  // ─── deployCommodityBatchToken ────────────────────────────────────────────

  describe("deployCommodityBatchToken", function () {
    beforeEach(async function () {
      await factory.registerTemplate(TMPL.COMMODITY_BATCH, await commodityBatchImpl.getAddress());
    });

    it("deploys a CommodityBatchToken proxy", async function () {
      const tx = await deployCommodityBatch();
      await tx.wait();
      expect(await factory.totalDeployedMultiTokens()).to.equal(1n);
    });

    it("emits MultiTokenDeployed event", async function () {
      await expect(deployCommodityBatch())
        .to.emit(factory, "MultiTokenDeployed")
        .withArgs(
          TMPL.COMMODITY_BATCH,
          (addr: string) => addr !== ethers.ZeroAddress,
          owner.address,
          ethers.ZeroHash,   // no assetId for CommodityBatch
          "NG",
          (ts: bigint) => ts > 0n
        );
    });

    it("deployed contract has correct name and countryCode", async function () {
      await deployCommodityBatch();
      const addrs = await factory.getDeployerMultiTokens(owner.address);
      const token = await ethers.getContractAt("CommodityBatchToken", addrs[0]) as CommodityBatchToken;
      expect(await token.contractName()).to.equal("Lagos Cocoa Warehouse");
      expect(await token.contractCountryCode()).to.equal("NG");
    });

    it("reverts if template not registered", async function () {
      const f2 = await (await ethers.getContractFactory("MultiTokenFactory"))
        .deploy(owner.address, owner.address) as MultiTokenFactory;
      await expect(
        f2.deployCommodityBatchToken("X", "NG", "ipfs://", owner.address, warehouseMeta())
      ).to.be.revertedWithCustomError(f2, "TemplateNotRegistered");
    });
  });

  // ─── deployPoolVault ──────────────────────────────────────────────────────

  describe("deployPoolVault", function () {
    beforeEach(async function () {
      await factory.registerTemplate(TMPL.POOL_VAULT, await poolVaultImpl.getAddress());
    });

    it("deploys a PoolVault proxy", async function () {
      await deployPool();
      expect(await factory.totalDeployedMultiTokens()).to.equal(1n);
    });

    it("emits MultiTokenDeployed event with correct assetId", async function () {
      await expect(deployPool())
        .to.emit(factory, "MultiTokenDeployed")
        .withArgs(
          TMPL.POOL_VAULT,
          (addr: string) => addr !== ethers.ZeroAddress,
          owner.address,
          ASSET_ID,
          "NG",
          (ts: bigint) => ts > 0n
        );
    });

    it("deployed vault has correct name, symbol, and managementFeeBps", async function () {
      await deployPool();
      const addrs = await factory.getDeployerMultiTokens(owner.address);
      const vault = await ethers.getContractAt("PoolVault", addrs[0]) as PoolVault;
      expect(await vault.name()).to.equal("West Africa Pool");
      expect(await vault.symbol()).to.equal("WACP");
      expect(await vault.managementFeeBps()).to.equal(50n);
    });

    it("reverts if template not registered", async function () {
      const f2 = await (await ethers.getContractFactory("MultiTokenFactory"))
        .deploy(owner.address, owner.address) as MultiTokenFactory;
      await expect(
        f2.deployPoolVault("X", "X", ASSET_ID, "NG", owner.address, ethers.ZeroAddress, ethers.ZeroAddress, 50n)
      ).to.be.revertedWithCustomError(f2, "TemplateNotRegistered");
    });
  });

  // ─── Registry ─────────────────────────────────────────────────────────────

  describe("registry", function () {
    beforeEach(async function () {
      await registerAll();
    });

    it("tracks allDeployedMultiTokens across templates", async function () {
      await deployCommodityBatch();
      await deployPool();
      expect(await factory.totalDeployedMultiTokens()).to.equal(2n);
    });

    it("tracks deployments per deployer", async function () {
      await deployCommodityBatch(deployer);
      await deployCommodityBatch(deployer);
      await deployPool(owner);

      expect((await factory.getDeployerMultiTokens(deployer.address)).length).to.equal(2);
      expect((await factory.getDeployerMultiTokens(owner.address)).length).to.equal(1);
    });

    it("each deployer sees only their own contracts", async function () {
      await deployCommodityBatch(owner);
      await deployPool(deployer);

      const ownerContracts   = await factory.getDeployerMultiTokens(owner.address);
      const deployerContracts = await factory.getDeployerMultiTokens(deployer.address);

      expect(ownerContracts.length).to.equal(1);
      expect(deployerContracts.length).to.equal(1);
      expect(ownerContracts[0]).to.not.equal(deployerContracts[0]);
    });
  });

  // ─── Fee management ───────────────────────────────────────────────────────

  describe("fee management", function () {
    beforeEach(async function () {
      await registerAll();
    });

    it("owner can set deployment fee", async function () {
      const fee = ethers.parseEther("0.001");
      await expect(factory.setDeploymentFee(fee))
        .to.emit(factory, "DeploymentFeeUpdated")
        .withArgs(0n, fee);
      expect(await factory.deploymentFee()).to.equal(fee);
    });

    it("owner can set fee recipient", async function () {
      await expect(factory.setFeeRecipient(deployer.address))
        .to.emit(factory, "FeeRecipientUpdated")
        .withArgs(owner.address, deployer.address);
    });

    it("stranger cannot set deployment fee", async function () {
      await expect(factory.connect(stranger).setDeploymentFee(1n)).to.be.reverted;
    });

    it("collects fee on deployment and owner can withdraw", async function () {
      const fee = ethers.parseEther("0.01");
      await factory.setDeploymentFee(fee);

      await factory.deployCommodityBatchToken(
        "Lagos Warehouse", "NG", "ipfs://", owner.address, warehouseMeta(),
        { value: fee }
      );

      const factoryAddr = await factory.getAddress();
      expect(await ethers.provider.getBalance(factoryAddr)).to.equal(fee);

      await factory.withdrawFees();
      expect(await ethers.provider.getBalance(factoryAddr)).to.equal(0n);
    });

    it("reverts deployment when fee is insufficient", async function () {
      await factory.setDeploymentFee(ethers.parseEther("0.01"));
      await expect(
        factory.deployCommodityBatchToken("X", "NG", "ipfs://", owner.address, warehouseMeta(), { value: 0n })
      ).to.be.revertedWithCustomError(factory, "InsufficientFee");
    });
  });
});
