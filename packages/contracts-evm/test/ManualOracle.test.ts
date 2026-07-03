import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { ManualOracle } from "../typechain-types";

describe("ManualOracle", function () {
  let oracle: ManualOracle;
  let owner: any, stranger: any;

  const TOKEN_A = ethers.Wallet.createRandom().address;
  const TOKEN_B = ethers.Wallet.createRandom().address;
  const ONE_DAY = 86_400n;

  beforeEach(async function () {
    [owner, stranger] = await ethers.getSigners();
    oracle = await (await ethers.getContractFactory("ManualOracle"))
      .deploy(owner.address, ONE_DAY) as ManualOracle;
  });

  // ─── Deployment ──────────────────────────────────────────────────────────

  describe("deployment", function () {
    it("sets stalenessThreshold correctly", async function () {
      expect(await oracle.stalenessThreshold()).to.equal(ONE_DAY);
    });

    it("grants MANAGER_ROLE to admin", async function () {
      const MANAGER = await oracle.MANAGER_ROLE();
      expect(await oracle.hasRole(MANAGER, owner.address)).to.be.true;
    });

    it("returns stale for a never-set token", async function () {
      expect(await oracle.isStale(TOKEN_A)).to.be.true;
    });
  });

  // ─── setPrice ────────────────────────────────────────────────────────────

  describe("setPrice", function () {
    it("MANAGER_ROLE can set a price", async function () {
      await expect(oracle.setPrice(TOKEN_A, 1n * 10n ** 18n)).to.not.be.reverted;
      const [price] = await oracle.getPrice(TOKEN_A);
      expect(price).to.equal(1n * 10n ** 18n);
    });

    it("emits PriceSet event", async function () {
      const priceUSD = 2n * 10n ** 18n;
      await expect(oracle.setPrice(TOKEN_A, priceUSD))
        .to.emit(oracle, "PriceSet")
        .withArgs(TOKEN_A, priceUSD, (ts: bigint) => ts > 0n);
    });

    it("stranger cannot set price", async function () {
      await expect(oracle.connect(stranger).setPrice(TOKEN_A, 1n)).to.be.reverted;
    });
  });

  // ─── getPrice ────────────────────────────────────────────────────────────

  describe("getPrice", function () {
    it("returns price and timestamp after set", async function () {
      const priceUSD = 500n * 10n ** 18n;
      await oracle.setPrice(TOKEN_A, priceUSD);
      const [price, ts] = await oracle.getPrice(TOKEN_A);
      expect(price).to.equal(priceUSD);
      expect(ts).to.be.gt(0n);
    });

    it("returns 0, 0 for never-set token", async function () {
      const [price, ts] = await oracle.getPrice(TOKEN_B);
      expect(price).to.equal(0n);
      expect(ts).to.equal(0n);
    });
  });

  // ─── isStale ─────────────────────────────────────────────────────────────

  describe("isStale", function () {
    it("returns false immediately after setting price", async function () {
      await oracle.setPrice(TOKEN_A, 1n * 10n ** 18n);
      expect(await oracle.isStale(TOKEN_A)).to.be.false;
    });

    it("returns true when price was never set (timestamp = 0)", async function () {
      expect(await oracle.isStale(TOKEN_B)).to.be.true;
    });

    it("returns true after stalenessThreshold seconds have elapsed", async function () {
      await oracle.setPrice(TOKEN_A, 1n * 10n ** 18n);
      // Advance time beyond the 24h threshold
      await time.increase(86_401);
      expect(await oracle.isStale(TOKEN_A)).to.be.true;
    });

    it("returns false just before stalenessThreshold elapses", async function () {
      await oracle.setPrice(TOKEN_A, 1n * 10n ** 18n);
      await time.increase(86_399);
      expect(await oracle.isStale(TOKEN_A)).to.be.false;
    });
  });

  // ─── setStalenessThreshold ───────────────────────────────────────────────

  describe("setStalenessThreshold", function () {
    it("MANAGER_ROLE can update staleness threshold", async function () {
      await oracle.setStalenessThreshold(3600n); // 1 hour
      expect(await oracle.stalenessThreshold()).to.equal(3600n);
    });

    it("emits StalenessThresholdUpdated event", async function () {
      await expect(oracle.setStalenessThreshold(3600n))
        .to.emit(oracle, "StalenessThresholdUpdated")
        .withArgs(ONE_DAY, 3600n);
    });

    it("stranger cannot update threshold", async function () {
      await expect(oracle.connect(stranger).setStalenessThreshold(0n)).to.be.reverted;
    });
  });
});
