import { expect } from "chai";
import { ethers } from "hardhat";
import type { WhitelistVerifier } from "../typechain-types";

describe("WhitelistVerifier", function () {
  let verifier: WhitelistVerifier;
  let owner: any, user1: any, user2: any, user3: any, stranger: any;

  beforeEach(async function () {
    [owner, user1, user2, user3, stranger] = await ethers.getSigners();
    verifier = await (await ethers.getContractFactory("WhitelistVerifier"))
      .deploy(owner.address);
  });

  // ─── Deployment ───────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("sets owner correctly", async function () {
      expect(await verifier.owner()).to.equal(owner.address);
    });

    it("returns correct verifier name", async function () {
      expect(await verifier.verifierName()).to.equal("WhitelistVerifier");
    });

    it("no address is verified on deploy", async function () {
      expect(await verifier.isVerified(user1.address)).to.be.false;
      expect(await verifier.isVerified(owner.address)).to.be.false;
    });
  });

  // ─── verifyIdentity ───────────────────────────────────────────────────────

  describe("verifyIdentity", function () {
    it("owner can verify an address", async function () {
      await verifier.verifyIdentity(user1.address);
      expect(await verifier.isVerified(user1.address)).to.be.true;
    });

    it("emits IdentityVerified event", async function () {
      await expect(verifier.verifyIdentity(user1.address))
        .to.emit(verifier, "IdentityVerified");
    });

    it("stranger cannot verify", async function () {
      await expect(
        verifier.connect(stranger).verifyIdentity(user1.address)
      ).to.be.reverted;
    });

    it("verifying an already-verified address is idempotent", async function () {
      await verifier.verifyIdentity(user1.address);
      await verifier.verifyIdentity(user1.address); // should not revert
      expect(await verifier.isVerified(user1.address)).to.be.true;
    });
  });

  // ─── revokeIdentity ───────────────────────────────────────────────────────

  describe("revokeIdentity", function () {
    beforeEach(async function () {
      await verifier.verifyIdentity(user1.address);
    });

    it("owner can revoke a verified address", async function () {
      await verifier.revokeIdentity(user1.address);
      expect(await verifier.isVerified(user1.address)).to.be.false;
    });

    it("emits IdentityRevoked event", async function () {
      await expect(verifier.revokeIdentity(user1.address))
        .to.emit(verifier, "IdentityRevoked");
    });

    it("stranger cannot revoke", async function () {
      await expect(
        verifier.connect(stranger).revokeIdentity(user1.address)
      ).to.be.reverted;
    });

    it("revoking an unverified address is idempotent", async function () {
      await verifier.revokeIdentity(user2.address); // never verified
      expect(await verifier.isVerified(user2.address)).to.be.false;
    });
  });

  // ─── batchVerify ──────────────────────────────────────────────────────────

  describe("batchVerify", function () {
    it("owner can batch verify multiple addresses", async function () {
      await verifier.batchVerify([user1.address, user2.address, user3.address]);
      expect(await verifier.isVerified(user1.address)).to.be.true;
      expect(await verifier.isVerified(user2.address)).to.be.true;
      expect(await verifier.isVerified(user3.address)).to.be.true;
    });

    it("emits IdentityVerified for each address in the batch", async function () {
      // Chai's .emit() checks at least one emission — verify count via receipt
      const tx      = await verifier.batchVerify([user1.address, user2.address]);
      const receipt = await tx.wait();
      const events  = receipt!.logs.filter((log: any) => {
        try {
          return verifier.interface.parseLog(log)?.name === "IdentityVerified";
        } catch { return false; }
      });
      expect(events.length).to.equal(2);
    });

    it("stranger cannot batch verify", async function () {
      await expect(
        verifier.connect(stranger).batchVerify([user1.address])
      ).to.be.reverted;
    });

    it("handles an empty array without reverting", async function () {
      await expect(verifier.batchVerify([])).to.not.be.reverted;
    });
  });

  // ─── isVerified ───────────────────────────────────────────────────────────

  describe("isVerified", function () {
    it("returns false for unverified address", async function () {
      expect(await verifier.isVerified(stranger.address)).to.be.false;
    });

    it("returns true after verification", async function () {
      await verifier.verifyIdentity(user1.address);
      expect(await verifier.isVerified(user1.address)).to.be.true;
    });

    it("returns false after revocation", async function () {
      await verifier.verifyIdentity(user1.address);
      await verifier.revokeIdentity(user1.address);
      expect(await verifier.isVerified(user1.address)).to.be.false;
    });

    it("only verifies the target address — others remain unverified", async function () {
      await verifier.verifyIdentity(user1.address);
      expect(await verifier.isVerified(user2.address)).to.be.false;
      expect(await verifier.isVerified(user3.address)).to.be.false;
    });
  });
});
