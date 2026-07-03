import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { MilestoneEscrow, FarmlandToken, WhitelistVerifier } from "../typechain-types";

describe("MilestoneEscrow", function () {
  let escrow: MilestoneEscrow;
  let stablecoin: FarmlandToken; // stand-in ERC-20 for testing, same pattern as PoolVault tests
  let admin: any, payer: any, payee: any, arbiter: any, stranger: any;

  const SEVEN_DAYS = 7n * 24n * 60n * 60n;
  const AMOUNTS = [300n * 10n ** 18n, 400n * 10n ** 18n, 300n * 10n ** 18n];
  const TOTAL   = AMOUNTS.reduce((a, b) => a + b, 0n);
  const HASHES  = [
    ethers.keccak256(ethers.toUtf8Bytes("deposit")),
    ethers.keccak256(ethers.toUtf8Bytes("shipment")),
    ethers.keccak256(ethers.toUtf8Bytes("delivery")),
  ];

  const farmMeta = () => ({
    location: "6.52, 3.38", areaSqMeters: 1000n, soilType: "loam",
    irrigationType: "rain-fed", cropHistory: "maize",
    titleDocumentHash: ethers.ZeroHash,
    valuationUSD: 100_000n * 10n ** 18n,
    stateRegion: "Lagos",
    lastUpdated: BigInt(Math.floor(Date.now() / 1000)),
  });

  async function deployStablecoin(): Promise<FarmlandToken> {
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

  async function deployEscrow(opts: Partial<{
    arbiter: string; token: string; identityVerifier: string; timelock: bigint;
    amounts: bigint[]; hashes: string[];
  }> = {}): Promise<MilestoneEscrow> {
    const E = await ethers.getContractFactory("MilestoneEscrow");
    const e = (await E.deploy()) as unknown as MilestoneEscrow;
    await e.initialize(
      admin.address,
      payer.address,
      payee.address,
      opts.arbiter ?? arbiter.address,
      opts.token ?? await stablecoin.getAddress(),
      opts.identityVerifier ?? ethers.ZeroAddress,
      opts.timelock ?? SEVEN_DAYS,
      opts.amounts ?? AMOUNTS,
      opts.hashes ?? HASHES
    );
    return e;
  }

  beforeEach(async function () {
    [admin, payer, payee, arbiter, stranger] = await ethers.getSigners();

    stablecoin = await deployStablecoin();
    await stablecoin.mint(payer.address, TOTAL);

    escrow = await deployEscrow();
    await stablecoin.connect(payer).approve(await escrow.getAddress(), ethers.MaxUint256);
  });

  // ─── Deployment ───────────────────────────────────────────────────────────

  describe("deployment", function () {
    it("sets payer, payee, arbiter, token", async function () {
      expect(await escrow.payer()).to.equal(payer.address);
      expect(await escrow.payee()).to.equal(payee.address);
      expect(await escrow.arbiter()).to.equal(arbiter.address);
      expect(await escrow.token()).to.equal(await stablecoin.getAddress());
    });

    it("sums milestone amounts into totalAmount", async function () {
      expect(await escrow.totalAmount()).to.equal(TOTAL);
    });

    it("creates one milestone per amount, all PENDING", async function () {
      expect(await escrow.milestoneCount()).to.equal(3n);
      for (let i = 0; i < 3; i++) {
        const m = await escrow.getMilestone(i);
        expect(m.amount).to.equal(AMOUNTS[i]);
        expect(m.descriptionHash).to.equal(HASHES[i]);
        expect(m.status).to.equal(0n); // PENDING
        expect(m.deliveredAt).to.equal(0n);
      }
    });

    it("starts unfunded and not cancelled", async function () {
      expect(await escrow.funded()).to.be.false;
      expect(await escrow.cancelled()).to.be.false;
    });

    it("defaults timelockDuration to 7 days when 0 is passed", async function () {
      const e2 = await deployEscrow({ timelock: 0n });
      expect(await e2.timelockDuration()).to.equal(SEVEN_DAYS);
    });

    it("allows arbiter to be address(0)", async function () {
      const e2 = await deployEscrow({ arbiter: ethers.ZeroAddress });
      expect(await e2.arbiter()).to.equal(ethers.ZeroAddress);
    });

    it("grants admin roles to admin_", async function () {
      expect(await escrow.hasRole(await escrow.DEFAULT_ADMIN_ROLE(), admin.address)).to.be.true;
      expect(await escrow.hasRole(await escrow.PAUSER_ROLE(),        admin.address)).to.be.true;
      expect(await escrow.hasRole(await escrow.UPGRADER_ROLE(),      admin.address)).to.be.true;
      expect(await escrow.hasRole(await escrow.MANAGER_ROLE(),       admin.address)).to.be.true;
    });

    it("reverts on zero payer/payee/token address", async function () {
      const E = await ethers.getContractFactory("MilestoneEscrow");
      const e = (await E.deploy()) as unknown as MilestoneEscrow;
      await expect(e.initialize(
        admin.address, ethers.ZeroAddress, payee.address, arbiter.address,
        await stablecoin.getAddress(), ethers.ZeroAddress, SEVEN_DAYS, AMOUNTS, HASHES
      )).to.be.revertedWithCustomError(e, "ZeroAddress");
    });

    it("reverts when payer equals payee", async function () {
      const E = await ethers.getContractFactory("MilestoneEscrow");
      const e = (await E.deploy()) as unknown as MilestoneEscrow;
      await expect(e.initialize(
        admin.address, payer.address, payer.address, arbiter.address,
        await stablecoin.getAddress(), ethers.ZeroAddress, SEVEN_DAYS, AMOUNTS, HASHES
      )).to.be.revertedWithCustomError(e, "SamePartyNotAllowed");
    });

    it("reverts with no milestones", async function () {
      const E = await ethers.getContractFactory("MilestoneEscrow");
      const e = (await E.deploy()) as unknown as MilestoneEscrow;
      await expect(e.initialize(
        admin.address, payer.address, payee.address, arbiter.address,
        await stablecoin.getAddress(), ethers.ZeroAddress, SEVEN_DAYS, [], []
      )).to.be.revertedWithCustomError(e, "NoMilestones");
    });

    it("reverts on amounts/hashes length mismatch", async function () {
      const E = await ethers.getContractFactory("MilestoneEscrow");
      const e = (await E.deploy()) as unknown as MilestoneEscrow;
      await expect(e.initialize(
        admin.address, payer.address, payee.address, arbiter.address,
        await stablecoin.getAddress(), ethers.ZeroAddress, SEVEN_DAYS, AMOUNTS, [HASHES[0]]
      )).to.be.revertedWithCustomError(e, "LengthMismatch");
    });

    it("reverts on a zero-amount milestone", async function () {
      const E = await ethers.getContractFactory("MilestoneEscrow");
      const e = (await E.deploy()) as unknown as MilestoneEscrow;
      await expect(e.initialize(
        admin.address, payer.address, payee.address, arbiter.address,
        await stablecoin.getAddress(), ethers.ZeroAddress, SEVEN_DAYS, [0n], [HASHES[0]]
      )).to.be.revertedWithCustomError(e, "ZeroAmount");
    });
  });

  // ─── fund ─────────────────────────────────────────────────────────────────

  describe("fund", function () {
    it("transfers totalAmount from payer to escrow", async function () {
      await escrow.connect(payer).fund();
      expect(await stablecoin.balanceOf(await escrow.getAddress())).to.equal(TOTAL);
      expect(await escrow.funded()).to.be.true;
    });

    it("emits EscrowFunded", async function () {
      await expect(escrow.connect(payer).fund())
        .to.emit(escrow, "EscrowFunded")
        .withArgs(TOTAL);
    });

    it("reverts if caller is not payer", async function () {
      await expect(escrow.connect(stranger).fund())
        .to.be.revertedWithCustomError(escrow, "NotPayer");
    });

    it("reverts if already funded", async function () {
      await escrow.connect(payer).fund();
      await expect(escrow.connect(payer).fund())
        .to.be.revertedWithCustomError(escrow, "AlreadyFunded");
    });
  });

  // ─── markDelivered ────────────────────────────────────────────────────────

  describe("markDelivered", function () {
    beforeEach(async function () {
      await escrow.connect(payer).fund();
    });

    it("payee can mark a PENDING milestone delivered", async function () {
      await escrow.connect(payee).markDelivered(0);
      const m = await escrow.getMilestone(0);
      expect(m.status).to.equal(1n); // DELIVERED
      expect(m.deliveredAt).to.be.gt(0n);
    });

    it("emits MilestoneDelivered", async function () {
      await expect(escrow.connect(payee).markDelivered(0))
        .to.emit(escrow, "MilestoneDelivered");
    });

    it("reverts if caller is not payee", async function () {
      await expect(escrow.connect(payer).markDelivered(0))
        .to.be.revertedWithCustomError(escrow, "NotPayee");
    });

    it("reverts if escrow not funded", async function () {
      const e2 = await deployEscrow();
      await expect(e2.connect(payee).markDelivered(0))
        .to.be.revertedWithCustomError(e2, "NotFunded");
    });

    it("reverts if milestone already delivered", async function () {
      await escrow.connect(payee).markDelivered(0);
      await expect(escrow.connect(payee).markDelivered(0))
        .to.be.revertedWithCustomError(escrow, "InvalidMilestoneStatus");
    });

    it("reverts on out-of-range milestone id", async function () {
      await expect(escrow.connect(payee).markDelivered(99))
        .to.be.revertedWithCustomError(escrow, "InvalidMilestoneId");
    });
  });

  // ─── approveMilestone ─────────────────────────────────────────────────────

  describe("approveMilestone", function () {
    beforeEach(async function () {
      await escrow.connect(payer).fund();
      await escrow.connect(payee).markDelivered(0);
    });

    it("releases the milestone amount to payee", async function () {
      const before = await stablecoin.balanceOf(payee.address);
      await escrow.connect(payer).approveMilestone(0);
      const after = await stablecoin.balanceOf(payee.address);
      expect(after - before).to.equal(AMOUNTS[0]);
    });

    it("sets milestone status to RELEASED", async function () {
      await escrow.connect(payer).approveMilestone(0);
      const m = await escrow.getMilestone(0);
      expect(m.status).to.equal(3n); // RELEASED
    });

    it("emits MilestoneReleased with viaTimelock=false", async function () {
      await expect(escrow.connect(payer).approveMilestone(0))
        .to.emit(escrow, "MilestoneReleased")
        .withArgs(0n, AMOUNTS[0], false);
    });

    it("reverts if caller is not payer", async function () {
      await expect(escrow.connect(stranger).approveMilestone(0))
        .to.be.revertedWithCustomError(escrow, "NotPayer");
    });

    it("reverts if milestone is still PENDING", async function () {
      await expect(escrow.connect(payer).approveMilestone(1))
        .to.be.revertedWithCustomError(escrow, "InvalidMilestoneStatus");
    });
  });

  // ─── raiseDispute / resolveDispute ────────────────────────────────────────

  describe("raiseDispute / resolveDispute", function () {
    beforeEach(async function () {
      await escrow.connect(payer).fund();
      await escrow.connect(payee).markDelivered(0);
    });

    it("payer can raise a dispute on a DELIVERED milestone", async function () {
      await escrow.connect(payer).raiseDispute(0);
      const m = await escrow.getMilestone(0);
      expect(m.status).to.equal(2n); // DISPUTED
    });

    it("payee can also raise a dispute", async function () {
      await expect(escrow.connect(payee).raiseDispute(0)).to.not.be.reverted;
    });

    it("stranger cannot raise a dispute", async function () {
      await expect(escrow.connect(stranger).raiseDispute(0))
        .to.be.revertedWithCustomError(escrow, "NotParty");
    });

    it("cannot dispute a PENDING milestone", async function () {
      await expect(escrow.connect(payer).raiseDispute(1))
        .to.be.revertedWithCustomError(escrow, "InvalidMilestoneStatus");
    });

    it("arbiter resolving releaseToPayee=true pays the payee", async function () {
      await escrow.connect(payer).raiseDispute(0);
      const before = await stablecoin.balanceOf(payee.address);
      await escrow.connect(arbiter).resolveDispute(0, true);
      const after = await stablecoin.balanceOf(payee.address);
      expect(after - before).to.equal(AMOUNTS[0]);
      expect((await escrow.getMilestone(0)).status).to.equal(3n); // RELEASED
    });

    it("arbiter resolving releaseToPayee=false refunds the payer", async function () {
      await escrow.connect(payer).raiseDispute(0);
      const before = await stablecoin.balanceOf(payer.address);
      await escrow.connect(arbiter).resolveDispute(0, false);
      const after = await stablecoin.balanceOf(payer.address);
      expect(after - before).to.equal(AMOUNTS[0]);
      expect((await escrow.getMilestone(0)).status).to.equal(4n); // REFUNDED
    });

    it("emits DisputeResolved", async function () {
      await escrow.connect(payer).raiseDispute(0);
      await expect(escrow.connect(arbiter).resolveDispute(0, true))
        .to.emit(escrow, "DisputeResolved")
        .withArgs(0n, true);
    });

    it("reverts if caller is not the arbiter", async function () {
      await escrow.connect(payer).raiseDispute(0);
      await expect(escrow.connect(payer).resolveDispute(0, true))
        .to.be.revertedWithCustomError(escrow, "NotArbiter");
    });

    it("reverts if no arbiter is configured", async function () {
      const e2 = await deployEscrow({ arbiter: ethers.ZeroAddress });
      await stablecoin.mint(payer.address, TOTAL);
      await stablecoin.connect(payer).approve(await e2.getAddress(), ethers.MaxUint256);
      await e2.connect(payer).fund();
      await e2.connect(payee).markDelivered(0);
      await e2.connect(payer).raiseDispute(0);
      await expect(e2.connect(arbiter).resolveDispute(0, true))
        .to.be.revertedWithCustomError(e2, "NotArbiter");
    });

    it("reverts resolving a non-disputed milestone", async function () {
      await expect(escrow.connect(arbiter).resolveDispute(1, true))
        .to.be.revertedWithCustomError(escrow, "InvalidMilestoneStatus");
    });
  });

  // ─── claimTimelockRelease ─────────────────────────────────────────────────

  describe("claimTimelockRelease", function () {
    beforeEach(async function () {
      await escrow.connect(payer).fund();
      await escrow.connect(payee).markDelivered(0);
    });

    it("reverts before the timelock elapses", async function () {
      await expect(escrow.connect(stranger).claimTimelockRelease(0))
        .to.be.revertedWithCustomError(escrow, "TimelockNotElapsed");
    });

    it("releases to payee after the timelock elapses, callable by anyone", async function () {
      await time.increase(SEVEN_DAYS + 1n);
      const before = await stablecoin.balanceOf(payee.address);
      await escrow.connect(stranger).claimTimelockRelease(0);
      const after = await stablecoin.balanceOf(payee.address);
      expect(after - before).to.equal(AMOUNTS[0]);
    });

    it("emits MilestoneReleased with viaTimelock=true", async function () {
      await time.increase(SEVEN_DAYS + 1n);
      await expect(escrow.connect(stranger).claimTimelockRelease(0))
        .to.emit(escrow, "MilestoneReleased")
        .withArgs(0n, AMOUNTS[0], true);
    });

    it("reverts if the milestone was disputed instead", async function () {
      await escrow.connect(payer).raiseDispute(0);
      await time.increase(SEVEN_DAYS + 1n);
      await expect(escrow.connect(stranger).claimTimelockRelease(0))
        .to.be.revertedWithCustomError(escrow, "InvalidMilestoneStatus");
    });
  });

  // ─── voteCancel ───────────────────────────────────────────────────────────

  describe("voteCancel", function () {
    it("a single vote does not cancel the escrow", async function () {
      await escrow.connect(payer).voteCancel();
      expect(await escrow.cancelled()).to.be.false;
    });

    it("both votes cancel the escrow and refund PENDING milestones", async function () {
      await escrow.connect(payer).fund();
      await escrow.connect(payer).voteCancel();
      const before = await stablecoin.balanceOf(payer.address);
      await escrow.connect(payee).voteCancel();
      const after = await stablecoin.balanceOf(payer.address);

      expect(await escrow.cancelled()).to.be.true;
      expect(after - before).to.equal(TOTAL); // all 3 milestones were PENDING
    });

    it("only refunds PENDING milestones, leaves RELEASED ones alone", async function () {
      await escrow.connect(payer).fund();
      await escrow.connect(payee).markDelivered(0);
      await escrow.connect(payer).approveMilestone(0); // milestone 0 released

      const before = await stablecoin.balanceOf(payer.address);
      await escrow.connect(payer).voteCancel();
      await escrow.connect(payee).voteCancel();
      const after = await stablecoin.balanceOf(payer.address);

      expect(after - before).to.equal(AMOUNTS[1] + AMOUNTS[2]); // only the 2 still-PENDING ones
    });

    it("emits EscrowCancelled with the refunded amount", async function () {
      await escrow.connect(payer).fund();
      await escrow.connect(payer).voteCancel();
      await expect(escrow.connect(payee).voteCancel())
        .to.emit(escrow, "EscrowCancelled")
        .withArgs(TOTAL);
    });

    it("reverts if already cancelled", async function () {
      await escrow.connect(payer).voteCancel();
      await escrow.connect(payee).voteCancel();
      await expect(escrow.connect(payer).voteCancel())
        .to.be.revertedWithCustomError(escrow, "AlreadyCancelled");
    });

    it("reverts if caller is not payer or payee", async function () {
      await expect(escrow.connect(stranger).voteCancel())
        .to.be.revertedWithCustomError(escrow, "NotParty");
    });
  });

  // ─── Admin: setArbiter / setIdentityVerifier ─────────────────────────────

  describe("admin", function () {
    it("MANAGER_ROLE can update the arbiter", async function () {
      await expect(escrow.setArbiter(stranger.address))
        .to.emit(escrow, "ArbiterUpdated")
        .withArgs(arbiter.address, stranger.address);
      expect(await escrow.arbiter()).to.equal(stranger.address);
    });

    it("stranger cannot update the arbiter", async function () {
      await expect(escrow.connect(stranger).setArbiter(stranger.address))
        .to.be.reverted;
    });

    it("MANAGER_ROLE can update the identity verifier", async function () {
      await expect(escrow.setIdentityVerifier(stranger.address))
        .to.emit(escrow, "IdentityVerifierUpdated")
        .withArgs(ethers.ZeroAddress, stranger.address);
      expect(await escrow.identityVerifier()).to.equal(stranger.address);
    });
  });

  // ─── Pause ────────────────────────────────────────────────────────────────

  describe("pause", function () {
    it("fund reverts when paused", async function () {
      await escrow.pause();
      await expect(escrow.connect(payer).fund()).to.be.reverted;
    });

    it("markDelivered reverts when paused", async function () {
      await escrow.connect(payer).fund();
      await escrow.pause();
      await expect(escrow.connect(payee).markDelivered(0)).to.be.reverted;
    });

    it("voteCancel reverts when paused", async function () {
      await escrow.pause();
      await expect(escrow.connect(payer).voteCancel()).to.be.reverted;
    });

    it("stranger cannot pause", async function () {
      await expect(escrow.connect(stranger).pause()).to.be.reverted;
    });
  });

  // ─── Identity verifier gating ─────────────────────────────────────────────

  describe("identity verifier gating", function () {
    let verifier: WhitelistVerifier;
    let gatedEscrow: MilestoneEscrow;

    beforeEach(async function () {
      verifier = await (await ethers.getContractFactory("WhitelistVerifier"))
        .deploy(admin.address) as WhitelistVerifier;

      gatedEscrow = await deployEscrow({ identityVerifier: await verifier.getAddress() });
      await stablecoin.connect(payer).approve(await gatedEscrow.getAddress(), ethers.MaxUint256);
    });

    it("fund reverts if payer is not verified", async function () {
      await expect(gatedEscrow.connect(payer).fund())
        .to.be.revertedWithCustomError(gatedEscrow, "NotVerified");
    });

    it("fund succeeds once payer is verified", async function () {
      await verifier.verifyIdentity(payer.address);
      await expect(gatedEscrow.connect(payer).fund()).to.not.be.reverted;
    });

    it("approveMilestone reverts if payee is not verified", async function () {
      await verifier.verifyIdentity(payer.address);
      await gatedEscrow.connect(payer).fund();
      await gatedEscrow.connect(payee).markDelivered(0);

      await expect(gatedEscrow.connect(payer).approveMilestone(0))
        .to.be.revertedWithCustomError(gatedEscrow, "NotVerified");
    });

    it("approveMilestone succeeds once payee is verified", async function () {
      await verifier.verifyIdentity(payer.address);
      await verifier.verifyIdentity(payee.address);
      await gatedEscrow.connect(payer).fund();
      await gatedEscrow.connect(payee).markDelivered(0);

      await expect(gatedEscrow.connect(payer).approveMilestone(0)).to.not.be.reverted;
    });
  });

  // ─── Views ────────────────────────────────────────────────────────────────

  describe("views", function () {
    it("remainingBalance reflects the escrow's token balance", async function () {
      expect(await escrow.remainingBalance()).to.equal(0n);
      await escrow.connect(payer).fund();
      expect(await escrow.remainingBalance()).to.equal(TOTAL);
    });

    it("getMilestone reverts on an out-of-range id", async function () {
      await expect(escrow.getMilestone(99))
        .to.be.revertedWithCustomError(escrow, "InvalidMilestoneId");
    });
  });
});
