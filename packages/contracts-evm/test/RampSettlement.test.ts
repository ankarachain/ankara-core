import { expect } from "chai";
import { ethers } from "hardhat";
import type { RampSettlement, FarmlandToken } from "../typechain-types";

describe("RampSettlement", function () {
  let settlement: RampSettlement;
  let token: FarmlandToken; // stand-in ERC-20 for testing, same pattern as PoolVault/Escrow tests
  let admin: any, treasury: any, depositor: any, stranger: any;

  const AMOUNT = 500n * 10n ** 18n;
  const REF_ID = ethers.keccak256(ethers.toUtf8Bytes("provider-session-1"));
  const PROVIDER_REF = "yc-session-abc123";

  const farmMeta = () => ({
    location: "6.52, 3.38", areaSqMeters: 1000n, soilType: "loam",
    irrigationType: "rain-fed", cropHistory: "maize",
    titleDocumentHash: ethers.ZeroHash,
    valuationUSD: 100_000n * 10n ** 18n,
    stateRegion: "Lagos",
    lastUpdated: BigInt(Math.floor(Date.now() / 1000)),
  });

  async function deployToken(): Promise<FarmlandToken> {
    const Impl = await ethers.getContractFactory("FarmlandToken");
    const impl = await Impl.deploy();
    await impl.initialize(
      "Mock USD", "mUSD",
      ethers.keccak256(ethers.toUtf8Bytes("mUSD")),
      "NG",
      admin.address, ethers.ZeroAddress, admin.address,
      farmMeta()
    );
    return impl as unknown as FarmlandToken;
  }

  async function deploySettlement(opts: Partial<{ admin: string; treasury: string }> = {}): Promise<RampSettlement> {
    const S = await ethers.getContractFactory("RampSettlement");
    const s = (await S.deploy()) as unknown as RampSettlement;
    await s.initialize(opts.admin ?? admin.address, opts.treasury ?? treasury.address);
    return s;
  }

  beforeEach(async function () {
    [admin, treasury, depositor, stranger] = await ethers.getSigners();

    token = await deployToken();
    await token.mint(depositor.address, AMOUNT);

    settlement = await deploySettlement();
    await token.connect(depositor).approve(await settlement.getAddress(), ethers.MaxUint256);
  });

  // ─── Deployment ───────────────────────────────────────────────────────────

  describe("deployment", function () {
    it("sets the treasury", async function () {
      expect(await settlement.treasury()).to.equal(treasury.address);
    });

    it("grants admin roles to admin_", async function () {
      expect(await settlement.hasRole(await settlement.DEFAULT_ADMIN_ROLE(), admin.address)).to.be.true;
      expect(await settlement.hasRole(await settlement.SETTLER_ROLE(),        admin.address)).to.be.true;
      expect(await settlement.hasRole(await settlement.PAUSER_ROLE(),         admin.address)).to.be.true;
      expect(await settlement.hasRole(await settlement.UPGRADER_ROLE(),       admin.address)).to.be.true;
      expect(await settlement.hasRole(await settlement.MANAGER_ROLE(),        admin.address)).to.be.true;
    });

    it("reverts on zero admin or treasury address", async function () {
      const S = await ethers.getContractFactory("RampSettlement");
      const s = (await S.deploy()) as unknown as RampSettlement;
      await expect(s.initialize(ethers.ZeroAddress, treasury.address))
        .to.be.revertedWithCustomError(s, "ZeroAddress");

      const s2 = (await S.deploy()) as unknown as RampSettlement;
      await expect(s2.initialize(admin.address, ethers.ZeroAddress))
        .to.be.revertedWithCustomError(s2, "ZeroAddress");
    });
  });

  // ─── initiateOffRamp ────────────────────────────────────────────────────────

  describe("initiateOffRamp", function () {
    it("pulls the deposited amount into the contract", async function () {
      await settlement.connect(depositor).initiateOffRamp(REF_ID, await token.getAddress(), AMOUNT, PROVIDER_REF);
      expect(await token.balanceOf(await settlement.getAddress())).to.equal(AMOUNT);
      expect(await token.balanceOf(depositor.address)).to.equal(0n);
    });

    it("records a PENDING deposit", async function () {
      await settlement.connect(depositor).initiateOffRamp(REF_ID, await token.getAddress(), AMOUNT, PROVIDER_REF);
      const d = await settlement.getOffRamp(REF_ID);
      expect(d.depositor).to.equal(depositor.address);
      expect(d.token).to.equal(await token.getAddress());
      expect(d.amount).to.equal(AMOUNT);
      expect(d.status).to.equal(1n); // PENDING
    });

    it("emits OffRampInitiated", async function () {
      await expect(settlement.connect(depositor).initiateOffRamp(REF_ID, await token.getAddress(), AMOUNT, PROVIDER_REF))
        .to.emit(settlement, "OffRampInitiated")
        .withArgs(REF_ID, depositor.address, await token.getAddress(), AMOUNT, PROVIDER_REF);
    });

    it("reverts on zero token address", async function () {
      await expect(settlement.connect(depositor).initiateOffRamp(REF_ID, ethers.ZeroAddress, AMOUNT, PROVIDER_REF))
        .to.be.revertedWithCustomError(settlement, "ZeroAddress");
    });

    it("reverts on zero amount", async function () {
      await expect(settlement.connect(depositor).initiateOffRamp(REF_ID, await token.getAddress(), 0n, PROVIDER_REF))
        .to.be.revertedWithCustomError(settlement, "ZeroAmount");
    });

    it("reverts if the referenceId was already used", async function () {
      await settlement.connect(depositor).initiateOffRamp(REF_ID, await token.getAddress(), AMOUNT, PROVIDER_REF);
      await token.mint(depositor.address, AMOUNT);
      await expect(settlement.connect(depositor).initiateOffRamp(REF_ID, await token.getAddress(), AMOUNT, PROVIDER_REF))
        .to.be.revertedWithCustomError(settlement, "ReferenceAlreadyUsed");
    });
  });

  // ─── confirmOffRampSettlement ───────────────────────────────────────────────

  describe("confirmOffRampSettlement", function () {
    beforeEach(async function () {
      await settlement.connect(depositor).initiateOffRamp(REF_ID, await token.getAddress(), AMOUNT, PROVIDER_REF);
    });

    it("releases the custodied amount to the treasury", async function () {
      const before = await token.balanceOf(treasury.address);
      await settlement.confirmOffRampSettlement(REF_ID);
      const after = await token.balanceOf(treasury.address);
      expect(after - before).to.equal(AMOUNT);
    });

    it("sets status to SETTLED", async function () {
      await settlement.confirmOffRampSettlement(REF_ID);
      expect((await settlement.getOffRamp(REF_ID)).status).to.equal(2n); // SETTLED
    });

    it("emits OffRampSettled", async function () {
      await expect(settlement.confirmOffRampSettlement(REF_ID))
        .to.emit(settlement, "OffRampSettled")
        .withArgs(REF_ID, treasury.address, AMOUNT);
    });

    it("reverts if caller lacks SETTLER_ROLE", async function () {
      await expect(settlement.connect(stranger).confirmOffRampSettlement(REF_ID)).to.be.reverted;
    });

    it("reverts if already settled", async function () {
      await settlement.confirmOffRampSettlement(REF_ID);
      await expect(settlement.confirmOffRampSettlement(REF_ID))
        .to.be.revertedWithCustomError(settlement, "InvalidStatus");
    });

    it("reverts on an unknown referenceId", async function () {
      const unknownRef = ethers.keccak256(ethers.toUtf8Bytes("nope"));
      await expect(settlement.confirmOffRampSettlement(unknownRef))
        .to.be.revertedWithCustomError(settlement, "InvalidStatus");
    });
  });

  // ─── refundOffRamp ──────────────────────────────────────────────────────────

  describe("refundOffRamp", function () {
    beforeEach(async function () {
      await settlement.connect(depositor).initiateOffRamp(REF_ID, await token.getAddress(), AMOUNT, PROVIDER_REF);
    });

    it("returns the custodied amount to the depositor", async function () {
      const before = await token.balanceOf(depositor.address);
      await settlement.refundOffRamp(REF_ID);
      const after = await token.balanceOf(depositor.address);
      expect(after - before).to.equal(AMOUNT);
    });

    it("sets status to REFUNDED", async function () {
      await settlement.refundOffRamp(REF_ID);
      expect((await settlement.getOffRamp(REF_ID)).status).to.equal(3n); // REFUNDED
    });

    it("emits OffRampRefunded", async function () {
      await expect(settlement.refundOffRamp(REF_ID))
        .to.emit(settlement, "OffRampRefunded")
        .withArgs(REF_ID, depositor.address, AMOUNT);
    });

    it("reverts if caller lacks MANAGER_ROLE", async function () {
      await expect(settlement.connect(stranger).refundOffRamp(REF_ID)).to.be.reverted;
    });

    it("reverts if already settled", async function () {
      await settlement.confirmOffRampSettlement(REF_ID);
      await expect(settlement.refundOffRamp(REF_ID))
        .to.be.revertedWithCustomError(settlement, "InvalidStatus");
    });

    it("reverts if already refunded", async function () {
      await settlement.refundOffRamp(REF_ID);
      await expect(settlement.refundOffRamp(REF_ID))
        .to.be.revertedWithCustomError(settlement, "InvalidStatus");
    });
  });

  // ─── recordOnRampSettlement ─────────────────────────────────────────────────

  describe("recordOnRampSettlement", function () {
    it("records the attestation without moving funds", async function () {
      const before = await token.balanceOf(await settlement.getAddress());
      await settlement.recordOnRampSettlement(REF_ID, depositor.address, await token.getAddress(), AMOUNT, PROVIDER_REF);
      const after = await token.balanceOf(await settlement.getAddress());
      expect(after).to.equal(before); // no custody movement

      const r = await settlement.getOnRamp(REF_ID);
      expect(r.recipient).to.equal(depositor.address);
      expect(r.token).to.equal(await token.getAddress());
      expect(r.amount).to.equal(AMOUNT);
      expect(r.status).to.equal(4n); // RECORDED
    });

    it("emits OnRampRecorded", async function () {
      await expect(settlement.recordOnRampSettlement(REF_ID, depositor.address, await token.getAddress(), AMOUNT, PROVIDER_REF))
        .to.emit(settlement, "OnRampRecorded")
        .withArgs(REF_ID, depositor.address, await token.getAddress(), AMOUNT, PROVIDER_REF);
    });

    it("reverts if caller lacks SETTLER_ROLE", async function () {
      await expect(
        settlement.connect(stranger).recordOnRampSettlement(REF_ID, depositor.address, await token.getAddress(), AMOUNT, PROVIDER_REF)
      ).to.be.reverted;
    });

    it("reverts on zero recipient or token", async function () {
      await expect(
        settlement.recordOnRampSettlement(REF_ID, ethers.ZeroAddress, await token.getAddress(), AMOUNT, PROVIDER_REF)
      ).to.be.revertedWithCustomError(settlement, "ZeroAddress");

      await expect(
        settlement.recordOnRampSettlement(REF_ID, depositor.address, ethers.ZeroAddress, AMOUNT, PROVIDER_REF)
      ).to.be.revertedWithCustomError(settlement, "ZeroAddress");
    });

    it("reverts on zero amount", async function () {
      await expect(
        settlement.recordOnRampSettlement(REF_ID, depositor.address, await token.getAddress(), 0n, PROVIDER_REF)
      ).to.be.revertedWithCustomError(settlement, "ZeroAmount");
    });

    it("reverts if the referenceId was already used", async function () {
      await settlement.recordOnRampSettlement(REF_ID, depositor.address, await token.getAddress(), AMOUNT, PROVIDER_REF);
      await expect(
        settlement.recordOnRampSettlement(REF_ID, depositor.address, await token.getAddress(), AMOUNT, PROVIDER_REF)
      ).to.be.revertedWithCustomError(settlement, "ReferenceAlreadyUsed");
    });
  });

  // ─── Admin ──────────────────────────────────────────────────────────────────

  describe("admin", function () {
    it("MANAGER_ROLE can update the treasury", async function () {
      await expect(settlement.setTreasury(stranger.address))
        .to.emit(settlement, "TreasuryUpdated")
        .withArgs(treasury.address, stranger.address);
      expect(await settlement.treasury()).to.equal(stranger.address);
    });

    it("stranger cannot update the treasury", async function () {
      await expect(settlement.connect(stranger).setTreasury(stranger.address)).to.be.reverted;
    });

    it("reverts setting treasury to the zero address", async function () {
      await expect(settlement.setTreasury(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(settlement, "ZeroAddress");
    });
  });

  // ─── Pause ──────────────────────────────────────────────────────────────────

  describe("pause", function () {
    it("initiateOffRamp reverts when paused", async function () {
      await settlement.pause();
      await expect(
        settlement.connect(depositor).initiateOffRamp(REF_ID, await token.getAddress(), AMOUNT, PROVIDER_REF)
      ).to.be.reverted;
    });

    it("confirmOffRampSettlement reverts when paused", async function () {
      await settlement.connect(depositor).initiateOffRamp(REF_ID, await token.getAddress(), AMOUNT, PROVIDER_REF);
      await settlement.pause();
      await expect(settlement.confirmOffRampSettlement(REF_ID)).to.be.reverted;
    });

    it("recordOnRampSettlement reverts when paused", async function () {
      await settlement.pause();
      await expect(
        settlement.recordOnRampSettlement(REF_ID, depositor.address, await token.getAddress(), AMOUNT, PROVIDER_REF)
      ).to.be.reverted;
    });

    it("stranger cannot pause", async function () {
      await expect(settlement.connect(stranger).pause()).to.be.reverted;
    });
  });

  // ─── Views ──────────────────────────────────────────────────────────────────

  describe("views", function () {
    it("getOffRamp returns a zeroed struct for an unknown referenceId", async function () {
      const d = await settlement.getOffRamp(ethers.keccak256(ethers.toUtf8Bytes("nope")));
      expect(d.status).to.equal(0n); // NONE
    });

    it("getOnRamp returns a zeroed struct for an unknown referenceId", async function () {
      const r = await settlement.getOnRamp(ethers.keccak256(ethers.toUtf8Bytes("nope")));
      expect(r.status).to.equal(0n); // NONE
    });
  });
});
