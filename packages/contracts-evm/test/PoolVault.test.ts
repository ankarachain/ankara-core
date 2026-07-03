import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { PoolVault, ManualOracle, FarmlandToken } from "../typechain-types";

describe("PoolVault", function () {
  let vault: PoolVault;
  let oracle: ManualOracle;
  let token1: FarmlandToken;   // underlying asset — priced at $1
  let token2: FarmlandToken;   // underlying asset — priced at $2
  let owner: any, user: any, stranger: any;

  const ASSET_ID  = ethers.keccak256(ethers.toUtf8Bytes("POOL-VAULT-001"));
  const ONE_DAY   = 86_400n;

  // $1 and $2 in 18-decimal USD representation
  const PRICE_1   = 1n * 10n ** 18n;
  const PRICE_2   = 2n * 10n ** 18n;

  // Farmland metadata stub (required by FarmlandToken.initialize)
  const farmMeta = () => ({
    location:          "6.5244, 3.3792",
    areaSqMeters:      10_000n,
    soilType:          "loam",
    irrigationType:    "rain-fed",
    cropHistory:       "maize",
    titleDocumentHash: ethers.ZeroHash,
    valuationUSD:      100_000n * 10n ** 18n,
    stateRegion:       "Lagos",
    lastUpdated:       BigInt(Math.floor(Date.now() / 1000)),
  });

  async function deployFarmlandToken(name: string, symbol: string): Promise<FarmlandToken> {
    const Impl = await ethers.getContractFactory("FarmlandToken");
    const impl = await Impl.deploy();
    await impl.initialize(
      name, symbol,
      ethers.keccak256(ethers.toUtf8Bytes(symbol)),
      "NG",
      owner.address, ethers.ZeroAddress, owner.address,
      farmMeta()
    );
    return impl as unknown as FarmlandToken;
  }

  beforeEach(async function () {
    [owner, user, stranger] = await ethers.getSigners();

    // Deploy two underlying Ankara ERC-20 tokens
    token1 = await deployFarmlandToken("Lagos Farmland Token", "LFT");
    token2 = await deployFarmlandToken("Kano Farmland Token",  "KFT");

    // Deploy ManualOracle and set prices
    oracle = await (await ethers.getContractFactory("ManualOracle"))
      .deploy(owner.address, ONE_DAY) as ManualOracle;

    await oracle.setPrice(await token1.getAddress(), PRICE_1);
    await oracle.setPrice(await token2.getAddress(), PRICE_2);

    // Deploy PoolVault directly (no factory)
    const PV = await ethers.getContractFactory("PoolVault");
    vault = (await PV.deploy()) as PoolVault;
    await vault.initialize(
      "West Africa Commodity Pool", "WACP",
      ASSET_ID, "NG",
      owner.address, ethers.ZeroAddress, owner.address,
      await oracle.getAddress(),
      50n   // 0.5% annual management fee
    );

    // Whitelist both tokens in the vault
    await vault.addAcceptedToken(await token1.getAddress(), 5000n); // 50% target weight
    await vault.addAcceptedToken(await token2.getAddress(), 5000n); // 50% target weight

    // Mint underlying tokens to user (owner has MINTER_ROLE)
    const amount = 1000n * 10n ** 18n;
    await token1.mint(user.address, amount);
    await token2.mint(user.address, amount);

    // User approves vault to spend their tokens
    await token1.connect(user).approve(await vault.getAddress(), ethers.MaxUint256);
    await token2.connect(user).approve(await vault.getAddress(), ethers.MaxUint256);
  });

  // ─── Deployment ───────────────────────────────────────────────────────────

  describe("deployment", function () {
    it("sets name and symbol", async function () {
      expect(await vault.name()).to.equal("West Africa Commodity Pool");
      expect(await vault.symbol()).to.equal("WACP");
    });

    it("sets managementFeeBps to 50 (0.5%)", async function () {
      expect(await vault.managementFeeBps()).to.equal(50n);
    });

    it("defaults managementFeeBps to 50 when 0 is passed", async function () {
      const PV = await ethers.getContractFactory("PoolVault");
      const v2 = await PV.deploy() as PoolVault;
      await v2.initialize(
        "V2", "V2", ASSET_ID, "NG",
        owner.address, ethers.ZeroAddress, owner.address,
        ethers.ZeroAddress, 0n   // pass 0 → defaults to 50
      );
      expect(await v2.managementFeeBps()).to.equal(50n);
    });

    it("NAVPerToken returns 1e18 ($1) when pool is empty", async function () {
      expect(await vault.NAVPerToken()).to.equal(1n * 10n ** 18n);
    });

    it("grants all roles to admin", async function () {
      expect(await vault.hasRole(await vault.MANAGER_ROLE(),  owner.address)).to.be.true;
      expect(await vault.hasRole(await vault.MINTER_ROLE(),   owner.address)).to.be.true;
      expect(await vault.hasRole(await vault.PAUSER_ROLE(),   owner.address)).to.be.true;
      expect(await vault.hasRole(await vault.UPGRADER_ROLE(), owner.address)).to.be.true;
    });
  });

  // ─── addAcceptedToken ─────────────────────────────────────────────────────

  describe("addAcceptedToken", function () {
    it("registers a token and sets weight", async function () {
      const addr = await token1.getAddress();
      expect(await vault.isAccepted(addr)).to.be.true;
      expect(await vault.tokenWeight(addr)).to.equal(5000n);
    });

    it("emits TokenAccepted event", async function () {
      // Deploy a third token and add it
      const token3 = await deployFarmlandToken("Enugu Token", "EGT");
      const addr3  = await token3.getAddress();
      await oracle.setPrice(addr3, PRICE_1);

      await expect(vault.addAcceptedToken(addr3, 2000n))
        .to.emit(vault, "TokenAccepted")
        .withArgs(addr3, 2000n);
    });

    it("reverts on duplicate token", async function () {
      await expect(vault.addAcceptedToken(await token1.getAddress(), 1000n))
        .to.be.revertedWithCustomError(vault, "TokenAlreadyAccepted");
    });

    it("stranger cannot add accepted token", async function () {
      const token3 = await deployFarmlandToken("Ibadan Token", "IBT");
      await expect(vault.connect(stranger).addAcceptedToken(await token3.getAddress(), 0n))
        .to.be.reverted;
    });

    it("reverts when MAX_TOKENS_PER_VAULT would be exceeded", async function () {
      // Already has 2 tokens. Deploy enough to hit the cap (50).
      for (let i = 2; i < 50; i++) {
        const t = await deployFarmlandToken(`Token${i}`, `T${i}`);
        const addr = await t.getAddress();
        await oracle.setPrice(addr, PRICE_1);
        await vault.addAcceptedToken(addr, 0n);
      }
      const t51 = await deployFarmlandToken("Token51", "T51");
      await oracle.setPrice(await t51.getAddress(), PRICE_1);
      await expect(vault.addAcceptedToken(await t51.getAddress(), 0n))
        .to.be.revertedWithCustomError(vault, "TooManyTokens");
    });
  });

  // ─── removeAcceptedToken ──────────────────────────────────────────────────

  describe("removeAcceptedToken", function () {
    it("removes a token from the accepted list", async function () {
      const addr = await token1.getAddress();
      await vault.removeAcceptedToken(addr);
      expect(await vault.isAccepted(addr)).to.be.false;
    });

    it("emits TokenRemoved event", async function () {
      const addr = await token1.getAddress();
      await expect(vault.removeAcceptedToken(addr))
        .to.emit(vault, "TokenRemoved")
        .withArgs(addr);
    });

    it("reverts if token was not accepted", async function () {
      const random = ethers.Wallet.createRandom().address;
      await expect(vault.removeAcceptedToken(random))
        .to.be.revertedWithCustomError(vault, "TokenNotAccepted");
    });
  });

  // ─── setOracle / setManagementFeeBps ──────────────────────────────────────

  describe("setOracle / setManagementFeeBps", function () {
    it("MANAGER_ROLE can set oracle and emits OracleUpdated", async function () {
      const newOracle = await (await ethers.getContractFactory("ManualOracle"))
        .deploy(owner.address, ONE_DAY) as ManualOracle;
      const newAddr = await newOracle.getAddress();
      const oldAddr = await oracle.getAddress();

      await expect(vault.setOracle(newAddr))
        .to.emit(vault, "OracleUpdated")
        .withArgs(oldAddr, newAddr);

      expect(await vault.oracle()).to.equal(newAddr);
    });

    it("MANAGER_ROLE can set management fee and emits event", async function () {
      await expect(vault.setManagementFeeBps(100n))
        .to.emit(vault, "ManagementFeeBpsUpdated")
        .withArgs(50n, 100n);
      expect(await vault.managementFeeBps()).to.equal(100n);
    });

    it("stranger cannot set oracle", async function () {
      await expect(vault.connect(stranger).setOracle(ethers.ZeroAddress)).to.be.reverted;
    });
  });

  // ─── deposit ──────────────────────────────────────────────────────────────

  describe("deposit", function () {
    it("mints pool tokens proportional to deposit USD value", async function () {
      const depositAmt = 100n * 10n ** 18n; // 100 token1 at $1 each = $100
      await vault.connect(user).deposit(await token1.getAddress(), depositAmt);
      // First deposit: 1 pool token = $1, so 100 pool tokens minted
      expect(await vault.balanceOf(user.address)).to.equal(100n * 10n ** 18n);
    });

    it("emits Deposited event", async function () {
      const addr = await token1.getAddress();
      const depositAmt = 50n * 10n ** 18n;
      await expect(vault.connect(user).deposit(addr, depositAmt))
        .to.emit(vault, "Deposited")
        .withArgs(user.address, addr, depositAmt, 50n * 10n ** 18n);
    });

    it("increases vault total supply", async function () {
      await vault.connect(user).deposit(await token1.getAddress(), 200n * 10n ** 18n);
      expect(await vault.totalSupply()).to.equal(200n * 10n ** 18n);
    });

    it("reverts for unaccepted token", async function () {
      const random = ethers.Wallet.createRandom().address;
      await expect(vault.connect(user).deposit(random, 1n))
        .to.be.revertedWithCustomError(vault, "TokenNotAccepted");
    });

    it("reverts on zero amount", async function () {
      await expect(vault.connect(user).deposit(await token1.getAddress(), 0n))
        .to.be.revertedWithCustomError(vault, "ZeroAmount");
    });

    it("reverts below minDeposit threshold", async function () {
      const addr = await token1.getAddress();
      await vault.setMinDeposit(addr, 100n * 10n ** 18n);
      await expect(vault.connect(user).deposit(addr, 50n * 10n ** 18n))
        .to.be.revertedWithCustomError(vault, "BelowMinDeposit");
    });

    it("reverts when oracle price is stale", async function () {
      const addr = await token1.getAddress();
      await time.increase(86_401); // advance past 24h staleness threshold
      await expect(vault.connect(user).deposit(addr, 100n * 10n ** 18n))
        .to.be.revertedWithCustomError(vault, "OraclePriceStale");
    });
  });

  // ─── withdraw ─────────────────────────────────────────────────────────────

  describe("withdraw", function () {
    beforeEach(async function () {
      // Deposit 100 token1 ($100 worth) → user holds 100 pool tokens
      await vault.connect(user).deposit(await token1.getAddress(), 100n * 10n ** 18n);
    });

    it("burns pool tokens and returns underlying assets", async function () {
      const poolBefore = await vault.balanceOf(user.address);
      await vault.connect(user).withdraw(poolBefore);
      expect(await vault.balanceOf(user.address)).to.equal(0n);
    });

    it("emits Withdrawn event", async function () {
      const poolAmt = await vault.balanceOf(user.address);
      await expect(vault.connect(user).withdraw(poolAmt))
        .to.emit(vault, "Withdrawn")
        .withArgs(user.address, poolAmt, [await token1.getAddress(), await token2.getAddress()], [100n * 10n ** 18n, 0n]);
    });

    it("proportional withdrawal returns correct token1 amount", async function () {
      const bal1Before = await token1.balanceOf(user.address);
      const poolAmt    = await vault.balanceOf(user.address);
      await vault.connect(user).withdraw(poolAmt / 2n); // withdraw half
      const bal1After = await token1.balanceOf(user.address);
      expect(bal1After - bal1Before).to.equal(50n * 10n ** 18n);
    });

    it("reverts on zero amount", async function () {
      await expect(vault.connect(user).withdraw(0n))
        .to.be.revertedWithCustomError(vault, "ZeroAmount");
    });

    it("reverts when user has insufficient pool tokens", async function () {
      const poolBal = await vault.balanceOf(user.address);
      await expect(vault.connect(user).withdraw(poolBal + 1n))
        .to.be.revertedWithCustomError(vault, "InsufficientPoolTokens");
    });
  });

  // ─── NAVPerToken / totalAUM ───────────────────────────────────────────────

  describe("NAVPerToken / totalAUM", function () {
    it("NAVPerToken returns 1e18 when vault is empty", async function () {
      expect(await vault.NAVPerToken()).to.equal(1n * 10n ** 18n);
    });

    it("NAVPerToken is $1 after first deposit at $1 token price", async function () {
      await vault.connect(user).deposit(await token1.getAddress(), 100n * 10n ** 18n);
      expect(await vault.NAVPerToken()).to.equal(1n * 10n ** 18n);
    });

    it("totalAUM returns 0 when oracle is not set", async function () {
      const PV = await ethers.getContractFactory("PoolVault");
      const v2 = await PV.deploy() as PoolVault;
      await v2.initialize(
        "No Oracle Pool", "NOP", ASSET_ID, "NG",
        owner.address, ethers.ZeroAddress, owner.address,
        ethers.ZeroAddress, // no oracle
        50n
      );
      expect(await v2.totalAUM()).to.equal(0n);
    });

    it("totalAUM reflects oracle prices correctly", async function () {
      // Deposit 100 token1 at $1 = $100 AUM
      await vault.connect(user).deposit(await token1.getAddress(), 100n * 10n ** 18n);
      expect(await vault.totalAUM()).to.equal(100n * 10n ** 18n);
    });

    it("NAVPerToken doubles when underlying price doubles", async function () {
      // Deposit 100 token1 at $1 → 100 pool tokens, NAV = $1
      await vault.connect(user).deposit(await token1.getAddress(), 100n * 10n ** 18n);

      // Double the price of token1 to $2
      await oracle.setPrice(await token1.getAddress(), PRICE_2);

      // AUM = 100 × $2 = $200; supply = 100; NAV = $2
      expect(await vault.NAVPerToken()).to.equal(2n * 10n ** 18n);
    });
  });

  // ─── accrueManagementFee ──────────────────────────────────────────────────

  describe("accrueManagementFee", function () {
    it("no-op when pool supply is zero", async function () {
      await expect(vault.accrueManagementFee()).to.not.emit(vault, "FeeAccrued");
    });

    it("accrues fee after one year elapses", async function () {
      // Deposit → 100 pool tokens in circulation
      await vault.connect(user).deposit(await token1.getAddress(), 100n * 10n ** 18n);

      await time.increase(365 * 24 * 60 * 60); // advance 1 year

      // At 50bps (0.5%) on 100e18 supply over 1 year → ~0.5e18 fee tokens
      await vault.accrueManagementFee();

      const feeRecipientBal = await vault.balanceOf(owner.address);
      // ~0.5e18 (small rounding tolerance)
      expect(feeRecipientBal).to.be.gt(0n);
      expect(feeRecipientBal).to.be.lte(1n * 10n ** 18n); // at most 1%
    });

    it("mints fee tokens to feeRecipient", async function () {
      await vault.connect(user).deposit(await token1.getAddress(), 100n * 10n ** 18n);
      const balBefore = await vault.balanceOf(owner.address);

      await time.increase(365 * 24 * 60 * 60);
      await vault.accrueManagementFee();

      expect(await vault.balanceOf(owner.address)).to.be.gt(balBefore);
    });

    it("emits FeeAccrued event", async function () {
      await vault.connect(user).deposit(await token1.getAddress(), 100n * 10n ** 18n);
      await time.increase(365 * 24 * 60 * 60);
      await expect(vault.accrueManagementFee())
        .to.emit(vault, "FeeAccrued");
    });
  });

  // ─── Pause ────────────────────────────────────────────────────────────────

  describe("pause", function () {
    it("deposit reverts when vault is paused", async function () {
      await vault.pause();
      await expect(vault.connect(user).deposit(await token1.getAddress(), 100n * 10n ** 18n))
        .to.be.reverted;
    });

    it("withdraw reverts when vault is paused", async function () {
      await vault.connect(user).deposit(await token1.getAddress(), 100n * 10n ** 18n);
      await vault.pause();
      const poolBal = await vault.balanceOf(user.address);
      await expect(vault.connect(user).withdraw(poolBal))
        .to.be.reverted;
    });
  });
});
