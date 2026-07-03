import { expect } from "chai";
import { ethers } from "hardhat";
import type { NFTFactory } from "../typechain-types";

describe("NFTFactory", function () {
  let factory: NFTFactory;
  let farmlandImpl:     any;
  let realEstateImpl:   any;
  let miningRightsImpl: any;
  let commodityImpl:    any;
  let owner: any, deployer: any, stranger: any;

  const TMPL = {
    FARMLAND:        0,
    REAL_ESTATE:     1,
    MINING_RIGHTS:   2,
    COMMODITY_VAULT: 3,
  };

  beforeEach(async function () {
    [owner, deployer, stranger] = await ethers.getSigners();

    farmlandImpl     = await (await ethers.getContractFactory("FarmlandNFT")).deploy();
    realEstateImpl   = await (await ethers.getContractFactory("RealEstateNFT")).deploy();
    miningRightsImpl = await (await ethers.getContractFactory("MiningRightsNFT")).deploy();
    commodityImpl    = await (await ethers.getContractFactory("CommodityVaultNFT")).deploy();

    factory = await (await ethers.getContractFactory("NFTFactory"))
      .deploy(owner.address, owner.address) as NFTFactory;
  });

  // ─── Helpers ──────────────────────────────────────────────────────────────

  async function registerAll() {
    await factory.registerTemplate(TMPL.FARMLAND,        await farmlandImpl.getAddress());
    await factory.registerTemplate(TMPL.REAL_ESTATE,     await realEstateImpl.getAddress());
    await factory.registerTemplate(TMPL.MINING_RIGHTS,   await miningRightsImpl.getAddress());
    await factory.registerTemplate(TMPL.COMMODITY_VAULT, await commodityImpl.getAddress());
  }

  const deployFarm = (caller = factory, admin = owner.address) =>
    (caller as any).deployFarmlandNFT(
      "Farm Deed", "FDEED", ethers.encodeBytes32String("F-001"), "NG",
      admin, ethers.ZeroAddress
    );

  const deployRE = (caller = factory, admin = owner.address) =>
    (caller as any).deployRealEstateNFT(
      "RE Deed", "REDEED", ethers.encodeBytes32String("RE-001"), "NG",
      admin, ethers.ZeroAddress
    );

  const deployMine = (caller = factory, admin = owner.address) =>
    (caller as any).deployMiningRightsNFT(
      "Mining License", "MINE", ethers.encodeBytes32String("M-001"), "GH",
      admin, ethers.ZeroAddress
    );

  const deployCommodity = (caller = factory, admin = owner.address) =>
    (caller as any).deployCommodityVaultNFT(
      "Coffee Vault", "CVLT", ethers.encodeBytes32String("C-001"), "KE",
      admin, ethers.ZeroAddress
    );

  // ─── Constructor ──────────────────────────────────────────────────────────

  describe("constructor", function () {
    it("sets owner", async function () {
      expect(await factory.owner()).to.equal(owner.address);
    });

    it("sets feeRecipient", async function () {
      expect(await factory.feeRecipient()).to.equal(owner.address);
    });

    it("starts with zero deploymentFee", async function () {
      expect(await factory.deploymentFee()).to.equal(0n);
    });

    it("starts with zero deployed NFTs", async function () {
      expect(await factory.totalDeployedNFTs()).to.equal(0n);
    });

    it("reverts when feeRecipient is zero address", async function () {
      await expect(
        (await ethers.getContractFactory("NFTFactory")).deploy(owner.address, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(factory, "ZeroAddress");
    });
  });

  // ─── Template registration ────────────────────────────────────────────────

  describe("registerTemplate", function () {
    it("owner can register all 4 NFT templates", async function () {
      await registerAll();
      expect(await factory.implementations(TMPL.FARMLAND)).to.equal(await farmlandImpl.getAddress());
      expect(await factory.implementations(TMPL.REAL_ESTATE)).to.equal(await realEstateImpl.getAddress());
      expect(await factory.implementations(TMPL.MINING_RIGHTS)).to.equal(await miningRightsImpl.getAddress());
      expect(await factory.implementations(TMPL.COMMODITY_VAULT)).to.equal(await commodityImpl.getAddress());
    });

    it("emits NFTTemplateRegistered event", async function () {
      await expect(factory.registerTemplate(TMPL.FARMLAND, await farmlandImpl.getAddress()))
        .to.emit(factory, "NFTTemplateRegistered")
        .withArgs(TMPL.FARMLAND, await farmlandImpl.getAddress());
    });

    it("stranger cannot register", async function () {
      await expect(
        factory.connect(stranger).registerTemplate(TMPL.FARMLAND, await farmlandImpl.getAddress())
      ).to.be.reverted;
    });

    it("reverts on zero implementation address", async function () {
      await expect(factory.registerTemplate(TMPL.FARMLAND, ethers.ZeroAddress))
        .to.be.revertedWithCustomError(factory, "ZeroAddress");
    });
  });

  // ─── deployFarmlandNFT ────────────────────────────────────────────────────

  describe("deployFarmlandNFT", function () {
    beforeEach(async function () {
      await registerAll();
    });

    it("deploys a FarmlandNFT proxy and returns a non-zero address", async function () {
      const nftAddr = await factory.deployFarmlandNFT.staticCall(
        "Farm Deed", "FDEED", ethers.encodeBytes32String("F-001"), "NG",
        deployer.address, ethers.ZeroAddress
      );
      expect(nftAddr).to.not.equal(ethers.ZeroAddress);
    });

    it("registers in allDeployedNFTs and deployerNFTs", async function () {
      await factory.connect(deployer).deployFarmlandNFT(
        "Farm Deed", "FDEED", ethers.encodeBytes32String("F-001"), "NG",
        deployer.address, ethers.ZeroAddress
      );
      expect(await factory.totalDeployedNFTs()).to.equal(1n);
      const deployerList = await factory.getDeployerNFTs(deployer.address);
      expect(deployerList.length).to.equal(1);
    });

    it("emits NFTDeployed event", async function () {
      await expect(deployFarm()).to.emit(factory, "NFTDeployed");
    });

    it("reverts when template not registered", async function () {
      const fresh = await (await ethers.getContractFactory("NFTFactory"))
        .deploy(owner.address, owner.address) as NFTFactory;
      await expect(
        fresh.deployFarmlandNFT(
          "Farm Deed", "FDEED", ethers.encodeBytes32String("F-001"), "NG",
          owner.address, ethers.ZeroAddress
        )
      ).to.be.revertedWithCustomError(fresh, "TemplateNotRegistered");
    });
  });

  // ─── deployRealEstateNFT ──────────────────────────────────────────────────

  describe("deployRealEstateNFT", function () {
    beforeEach(async function () {
      await registerAll();
    });

    it("deploys and tracks in registry", async function () {
      await deployRE();
      expect(await factory.totalDeployedNFTs()).to.equal(1n);
    });

    it("emits NFTDeployed event", async function () {
      await expect(deployRE()).to.emit(factory, "NFTDeployed");
    });
  });

  // ─── deployMiningRightsNFT ────────────────────────────────────────────────

  describe("deployMiningRightsNFT", function () {
    beforeEach(async function () {
      await registerAll();
    });

    it("deploys and tracks in registry", async function () {
      await deployMine();
      expect(await factory.totalDeployedNFTs()).to.equal(1n);
    });

    it("emits NFTDeployed event", async function () {
      await expect(deployMine()).to.emit(factory, "NFTDeployed");
    });
  });

  // ─── deployCommodityVaultNFT ──────────────────────────────────────────────

  describe("deployCommodityVaultNFT", function () {
    beforeEach(async function () {
      await registerAll();
    });

    it("deploys and tracks in registry", async function () {
      await deployCommodity();
      expect(await factory.totalDeployedNFTs()).to.equal(1n);
    });

    it("emits NFTDeployed event", async function () {
      await expect(deployCommodity()).to.emit(factory, "NFTDeployed");
    });
  });

  // ─── Registry tracking ────────────────────────────────────────────────────

  describe("registry tracking", function () {
    beforeEach(async function () {
      await registerAll();
    });

    it("tracks multiple deploys across templates", async function () {
      await deployFarm();
      await deployRE();
      expect(await factory.totalDeployedNFTs()).to.equal(2n);
    });

    it("getDeployerNFTs returns all contracts for a deployer", async function () {
      await factory.connect(deployer).deployFarmlandNFT(
        "Farm Deed", "FDEED", ethers.encodeBytes32String("F-001"), "NG",
        deployer.address, ethers.ZeroAddress
      );
      await factory.connect(deployer).deployRealEstateNFT(
        "RE Deed", "REDEED", ethers.encodeBytes32String("RE-001"), "NG",
        deployer.address, ethers.ZeroAddress
      );
      const list = await factory.getDeployerNFTs(deployer.address);
      expect(list.length).to.equal(2);
    });

    it("different deployers tracked independently", async function () {
      await factory.connect(deployer).deployFarmlandNFT(
        "Farm Deed", "FDEED", ethers.encodeBytes32String("F-001"), "NG",
        deployer.address, ethers.ZeroAddress
      );
      await factory.connect(stranger).deployRealEstateNFT(
        "RE Deed", "REDEED", ethers.encodeBytes32String("RE-001"), "NG",
        stranger.address, ethers.ZeroAddress
      );
      const deployerList = await factory.getDeployerNFTs(deployer.address);
      const strangerList = await factory.getDeployerNFTs(stranger.address);
      expect(deployerList.length).to.equal(1);
      expect(strangerList.length).to.equal(1);
      expect(deployerList[0]).to.not.equal(strangerList[0]);
    });

    it("allDeployedNFTs grows with each deploy", async function () {
      await deployFarm();
      await deployRE();
      await deployMine();
      await deployCommodity();
      expect(await factory.totalDeployedNFTs()).to.equal(4n);
    });
  });

  // ─── Fee management ───────────────────────────────────────────────────────

  describe("fee management", function () {
    it("owner can set deployment fee", async function () {
      await factory.setDeploymentFee(ethers.parseEther("0.01"));
      expect(await factory.deploymentFee()).to.equal(ethers.parseEther("0.01"));
    });

    it("emits DeploymentFeeUpdated event", async function () {
      await expect(factory.setDeploymentFee(ethers.parseEther("0.01")))
        .to.emit(factory, "DeploymentFeeUpdated")
        .withArgs(0n, ethers.parseEther("0.01"));
    });

    it("stranger cannot set fee", async function () {
      await expect(factory.connect(stranger).setDeploymentFee(1n)).to.be.reverted;
    });

    it("rejects deploy when fee insufficient", async function () {
      await registerAll();
      await factory.setDeploymentFee(ethers.parseEther("0.1"));
      await expect(
        factory.deployFarmlandNFT(
          "Farm Deed", "FDEED", ethers.encodeBytes32String("F-001"), "NG",
          owner.address, ethers.ZeroAddress,
          { value: ethers.parseEther("0.05") }
        )
      ).to.be.revertedWithCustomError(factory, "InsufficientFee");
    });

    it("accepts deploy when fee is exactly met", async function () {
      await registerAll();
      await factory.setDeploymentFee(ethers.parseEther("0.1"));
      await expect(
        factory.deployFarmlandNFT(
          "Farm Deed", "FDEED", ethers.encodeBytes32String("F-001"), "NG",
          owner.address, ethers.ZeroAddress,
          { value: ethers.parseEther("0.1") }
        )
      ).to.not.be.reverted;
    });

    it("owner can set fee recipient", async function () {
      await factory.setFeeRecipient(deployer.address);
      expect(await factory.feeRecipient()).to.equal(deployer.address);
    });

    it("emits FeeRecipientUpdated event", async function () {
      await expect(factory.setFeeRecipient(deployer.address))
        .to.emit(factory, "FeeRecipientUpdated")
        .withArgs(owner.address, deployer.address);
    });

    it("reverts setFeeRecipient for zero address", async function () {
      await expect(factory.setFeeRecipient(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(factory, "ZeroAddress");
    });
  });
});
