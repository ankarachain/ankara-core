import { expect } from "chai";
import { ethers } from "hardhat";
import type { RampSettlementFactory, RampSettlement } from "../typechain-types";

describe("RampSettlementFactory", function () {
  let factory: RampSettlementFactory;
  let settlementImpl: any;
  let owner: any, deployer: any, treasury: any, stranger: any;

  beforeEach(async function () {
    [owner, deployer, treasury, stranger] = await ethers.getSigners();

    settlementImpl = await (await ethers.getContractFactory("RampSettlement")).deploy();

    factory = await (await ethers.getContractFactory("RampSettlementFactory"))
      .deploy(owner.address, owner.address) as RampSettlementFactory;
  });

  const deploySettlement = (caller = deployer, treasuryAddr?: string) =>
    factory.connect(caller).deployRampSettlement(caller.address, treasuryAddr ?? treasury.address);

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
        (await ethers.getContractFactory("RampSettlementFactory")).deploy(owner.address, ethers.ZeroAddress)
      ).to.be.reverted;
    });
  });

  // ─── setImplementation ────────────────────────────────────────────────────

  describe("setImplementation", function () {
    it("owner can set the implementation", async function () {
      const addr = await settlementImpl.getAddress();
      await expect(factory.setImplementation(addr))
        .to.emit(factory, "ImplementationUpdated")
        .withArgs(ethers.ZeroAddress, addr);
      expect(await factory.implementation()).to.equal(addr);
    });

    it("reverts on zero-address implementation", async function () {
      await expect(factory.setImplementation(ethers.ZeroAddress)).to.be.reverted;
    });

    it("stranger cannot set implementation", async function () {
      await expect(factory.connect(stranger).setImplementation(await settlementImpl.getAddress()))
        .to.be.reverted;
    });
  });

  // ─── deployRampSettlement ─────────────────────────────────────────────────

  describe("deployRampSettlement", function () {
    beforeEach(async function () {
      await factory.setImplementation(await settlementImpl.getAddress());
    });

    it("deploys a RampSettlement proxy", async function () {
      await deploySettlement();
      expect(await factory.totalDeployedRampSettlements()).to.equal(1n);
    });

    it("emits RampSettlementDeployed", async function () {
      await expect(deploySettlement())
        .to.emit(factory, "RampSettlementDeployed")
        .withArgs(
          (addr: string) => addr !== ethers.ZeroAddress,
          deployer.address,
          deployer.address,
          treasury.address,
          (ts: bigint) => ts > 0n
        );
    });

    it("deployed settlement is correctly initialized", async function () {
      await deploySettlement();
      const addrs = await factory.getDeployerRampSettlements(deployer.address);
      const s = await ethers.getContractAt("RampSettlement", addrs[0]) as RampSettlement;
      expect(await s.treasury()).to.equal(treasury.address);
      expect(await s.hasRole(await s.SETTLER_ROLE(), deployer.address)).to.be.true;
    });

    it("reverts if implementation is not set", async function () {
      const f2 = await (await ethers.getContractFactory("RampSettlementFactory"))
        .deploy(owner.address, owner.address) as RampSettlementFactory;
      await expect(
        f2.connect(deployer).deployRampSettlement(deployer.address, treasury.address)
      ).to.be.revertedWithCustomError(f2, "ImplementationNotSet");
    });
  });

  // ─── Registry ─────────────────────────────────────────────────────────────

  describe("registry", function () {
    beforeEach(async function () {
      await factory.setImplementation(await settlementImpl.getAddress());
    });

    it("tracks deployments per deployer", async function () {
      await deploySettlement(deployer);
      await deploySettlement(deployer);
      await deploySettlement(owner);

      expect((await factory.getDeployerRampSettlements(deployer.address)).length).to.equal(2);
      expect((await factory.getDeployerRampSettlements(owner.address)).length).to.equal(1);
    });

    it("each deployer sees only their own settlements", async function () {
      await deploySettlement(owner);
      await deploySettlement(deployer);

      const ownerSettlements    = await factory.getDeployerRampSettlements(owner.address);
      const deployerSettlements = await factory.getDeployerRampSettlements(deployer.address);

      expect(ownerSettlements.length).to.equal(1);
      expect(deployerSettlements.length).to.equal(1);
      expect(ownerSettlements[0]).to.not.equal(deployerSettlements[0]);
    });
  });

  // ─── Fee management ───────────────────────────────────────────────────────

  describe("fee management", function () {
    beforeEach(async function () {
      await factory.setImplementation(await settlementImpl.getAddress());
    });

    it("owner can set deployment fee", async function () {
      const fee = ethers.parseEther("0.001");
      await expect(factory.setDeploymentFee(fee))
        .to.emit(factory, "DeploymentFeeUpdated")
        .withArgs(0n, fee);
      expect(await factory.deploymentFee()).to.equal(fee);
    });

    it("stranger cannot set deployment fee", async function () {
      await expect(factory.connect(stranger).setDeploymentFee(1n)).to.be.reverted;
    });

    it("collects fee on deployment and owner can withdraw", async function () {
      const fee = ethers.parseEther("0.01");
      await factory.setDeploymentFee(fee);

      await factory.connect(deployer).deployRampSettlement(
        deployer.address, treasury.address, { value: fee }
      );

      const factoryAddr = await factory.getAddress();
      expect(await ethers.provider.getBalance(factoryAddr)).to.equal(fee);

      await factory.withdrawFees();
      expect(await ethers.provider.getBalance(factoryAddr)).to.equal(0n);
    });

    it("reverts deployment when fee is insufficient", async function () {
      await factory.setDeploymentFee(ethers.parseEther("0.01"));
      await expect(deploySettlement())
        .to.be.revertedWithCustomError(factory, "InsufficientFee");
    });
  });
});
