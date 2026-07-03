import { expect } from "chai";
import { ethers } from "hardhat";
import type { EscrowFactory, MilestoneEscrow, FarmlandToken } from "../typechain-types";

describe("EscrowFactory", function () {
  let factory: EscrowFactory;
  let escrowImpl: any;
  let stablecoin: FarmlandToken;
  let owner: any, deployer: any, payer: any, payee: any, stranger: any;

  const SEVEN_DAYS = 7n * 24n * 60n * 60n;
  const AMOUNTS = [300n * 10n ** 18n, 400n * 10n ** 18n, 300n * 10n ** 18n];
  const TOTAL   = AMOUNTS.reduce((a, b) => a + b, 0n);
  const HASHES  = [ethers.ZeroHash, ethers.ZeroHash, ethers.ZeroHash];

  const farmMeta = () => ({
    location: "6.52, 3.38", areaSqMeters: 1000n, soilType: "loam",
    irrigationType: "rain-fed", cropHistory: "maize",
    titleDocumentHash: ethers.ZeroHash,
    valuationUSD: 100_000n * 10n ** 18n,
    stateRegion: "Lagos",
    lastUpdated: BigInt(Math.floor(Date.now() / 1000)),
  });

  beforeEach(async function () {
    [owner, deployer, payer, payee, stranger] = await ethers.getSigners();

    escrowImpl = await (await ethers.getContractFactory("MilestoneEscrow")).deploy();

    const Stable = await ethers.getContractFactory("FarmlandToken");
    stablecoin = await Stable.deploy() as unknown as FarmlandToken;
    await stablecoin.initialize(
      "Mock USD", "mUSD", ethers.keccak256(ethers.toUtf8Bytes("mUSD")), "NG",
      owner.address, ethers.ZeroAddress, owner.address, farmMeta()
    );

    factory = await (await ethers.getContractFactory("EscrowFactory"))
      .deploy(owner.address, owner.address) as EscrowFactory;
  });

  const deployEscrow = (caller = deployer, token?: string, arbiter = ethers.ZeroAddress) =>
    factory.connect(caller).deployEscrow(
      caller.address, payer.address, payee.address, arbiter,
      token ?? stablecoin.getAddress(),
      ethers.ZeroAddress, SEVEN_DAYS, AMOUNTS, HASHES
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
        (await ethers.getContractFactory("EscrowFactory")).deploy(owner.address, ethers.ZeroAddress)
      ).to.be.reverted;
    });
  });

  // ─── setImplementation ────────────────────────────────────────────────────

  describe("setImplementation", function () {
    it("owner can set the implementation", async function () {
      const addr = await escrowImpl.getAddress();
      await expect(factory.setImplementation(addr))
        .to.emit(factory, "ImplementationUpdated")
        .withArgs(ethers.ZeroAddress, addr);
      expect(await factory.implementation()).to.equal(addr);
    });

    it("reverts on zero-address implementation", async function () {
      await expect(factory.setImplementation(ethers.ZeroAddress)).to.be.reverted;
    });

    it("stranger cannot set implementation", async function () {
      await expect(factory.connect(stranger).setImplementation(await escrowImpl.getAddress()))
        .to.be.reverted;
    });
  });

  // ─── setStablecoinAccepted ────────────────────────────────────────────────

  describe("setStablecoinAccepted", function () {
    it("owner can whitelist a stablecoin", async function () {
      const addr = await stablecoin.getAddress();
      await expect(factory.setStablecoinAccepted(addr, true))
        .to.emit(factory, "StablecoinAccepted")
        .withArgs(addr, true);
      expect(await factory.acceptedStablecoins(addr)).to.be.true;
    });

    it("owner can de-whitelist a stablecoin", async function () {
      const addr = await stablecoin.getAddress();
      await factory.setStablecoinAccepted(addr, true);
      await factory.setStablecoinAccepted(addr, false);
      expect(await factory.acceptedStablecoins(addr)).to.be.false;
    });

    it("stranger cannot whitelist a stablecoin", async function () {
      await expect(factory.connect(stranger).setStablecoinAccepted(await stablecoin.getAddress(), true))
        .to.be.reverted;
    });
  });

  // ─── deployEscrow ─────────────────────────────────────────────────────────

  describe("deployEscrow", function () {
    beforeEach(async function () {
      await factory.setImplementation(await escrowImpl.getAddress());
      await factory.setStablecoinAccepted(await stablecoin.getAddress(), true);
    });

    it("deploys a MilestoneEscrow proxy", async function () {
      await deployEscrow();
      expect(await factory.totalDeployedEscrows()).to.equal(1n);
    });

    it("emits EscrowDeployed with correct total", async function () {
      await expect(deployEscrow())
        .to.emit(factory, "EscrowDeployed")
        .withArgs(
          (addr: string) => addr !== ethers.ZeroAddress,
          deployer.address,
          payer.address,
          payee.address,
          await stablecoin.getAddress(),
          TOTAL,
          (ts: bigint) => ts > 0n
        );
    });

    it("deployed escrow is correctly initialized", async function () {
      await deployEscrow();
      const addrs = await factory.getDeployerEscrows(deployer.address);
      const e = await ethers.getContractAt("MilestoneEscrow", addrs[0]) as MilestoneEscrow;
      expect(await e.payer()).to.equal(payer.address);
      expect(await e.payee()).to.equal(payee.address);
      expect(await e.totalAmount()).to.equal(TOTAL);
    });

    it("reverts if implementation is not set", async function () {
      const f2 = await (await ethers.getContractFactory("EscrowFactory"))
        .deploy(owner.address, owner.address) as EscrowFactory;
      await f2.setStablecoinAccepted(await stablecoin.getAddress(), true);
      await expect(
        f2.connect(deployer).deployEscrow(
          deployer.address, payer.address, payee.address, ethers.ZeroAddress,
          await stablecoin.getAddress(), ethers.ZeroAddress, SEVEN_DAYS, AMOUNTS, HASHES
        )
      ).to.be.revertedWithCustomError(f2, "ImplementationNotSet");
    });

    it("reverts if the token is not a whitelisted stablecoin", async function () {
      const other = await (await ethers.getContractFactory("FarmlandToken")).deploy();
      await other.initialize(
        "Other", "OTH", ethers.keccak256(ethers.toUtf8Bytes("OTH")), "NG",
        owner.address, ethers.ZeroAddress, owner.address, farmMeta()
      );
      await expect(deployEscrow(deployer, await other.getAddress()))
        .to.be.revertedWithCustomError(factory, "StablecoinNotAccepted");
    });
  });

  // ─── Registry ─────────────────────────────────────────────────────────────

  describe("registry", function () {
    beforeEach(async function () {
      await factory.setImplementation(await escrowImpl.getAddress());
      await factory.setStablecoinAccepted(await stablecoin.getAddress(), true);
    });

    it("tracks deployments per deployer", async function () {
      await deployEscrow(deployer);
      await deployEscrow(deployer);
      await deployEscrow(owner);

      expect((await factory.getDeployerEscrows(deployer.address)).length).to.equal(2);
      expect((await factory.getDeployerEscrows(owner.address)).length).to.equal(1);
    });

    it("each deployer sees only their own escrows", async function () {
      await deployEscrow(owner);
      await deployEscrow(deployer);

      const ownerEscrows    = await factory.getDeployerEscrows(owner.address);
      const deployerEscrows = await factory.getDeployerEscrows(deployer.address);

      expect(ownerEscrows.length).to.equal(1);
      expect(deployerEscrows.length).to.equal(1);
      expect(ownerEscrows[0]).to.not.equal(deployerEscrows[0]);
    });
  });

  // ─── Fee management ───────────────────────────────────────────────────────

  describe("fee management", function () {
    beforeEach(async function () {
      await factory.setImplementation(await escrowImpl.getAddress());
      await factory.setStablecoinAccepted(await stablecoin.getAddress(), true);
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

      await factory.connect(deployer).deployEscrow(
        deployer.address, payer.address, payee.address, ethers.ZeroAddress,
        await stablecoin.getAddress(), ethers.ZeroAddress, SEVEN_DAYS, AMOUNTS, HASHES,
        { value: fee }
      );

      const factoryAddr = await factory.getAddress();
      expect(await ethers.provider.getBalance(factoryAddr)).to.equal(fee);

      await factory.withdrawFees();
      expect(await ethers.provider.getBalance(factoryAddr)).to.equal(0n);
    });

    it("reverts deployment when fee is insufficient", async function () {
      await factory.setDeploymentFee(ethers.parseEther("0.01"));
      await expect(deployEscrow())
        .to.be.revertedWithCustomError(factory, "InsufficientFee");
    });
  });
});
