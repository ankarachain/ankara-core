import { expect } from "chai";
import { ethers } from "hardhat";
import type { FarmlandNFT, WhitelistVerifier } from "../typechain-types";

/**
 * AnkaraNFTBase — tests via FarmlandNFT (the simplest concrete NFT implementation)
 */
describe("AnkaraNFTBase (via FarmlandNFT)", function () {
  let nft: FarmlandNFT;
  let verifier: WhitelistVerifier;
  let owner: any, minter: any, user: any, stranger: any;

  const ASSET_ID  = ethers.encodeBytes32String("FARM-NG-001");
  const COUNTRY   = "NG";

  const emptyMeta = () => ({
    location: "6.4550°N, 3.3841°E",
    areaSqMeters: 50000n,
    soilType: "loam",
    irrigationType: "rain-fed",
    cropHistory: "maize,sorghum",
    titleDocumentHash: ethers.ZeroHash,
    surveyReportHash:  ethers.ZeroHash,
    stateRegion: "Lagos",
    lastUpdated: 0n,
  });

  beforeEach(async function () {
    [owner, minter, user, stranger] = await ethers.getSigners();

    verifier = await (await ethers.getContractFactory("WhitelistVerifier"))
      .deploy(owner.address);

    const Impl = await ethers.getContractFactory("FarmlandNFT");
    nft = (await Impl.deploy()) as FarmlandNFT;
    await nft.initialize("Farm Deed", "FDEED", ASSET_ID, COUNTRY, owner.address, ethers.ZeroAddress);
  });

  // ─── Deployment ───────────────────────────────────────────────────────────

  describe("deployment", function () {
    it("sets name and symbol", async function () {
      expect(await nft.name()).to.equal("Farm Deed");
      expect(await nft.symbol()).to.equal("FDEED");
    });

    it("sets assetId and countryCode", async function () {
      expect(await nft.assetId()).to.equal(ASSET_ID);
      expect(await nft.countryCode()).to.equal(COUNTRY);
    });

    it("starts in DRAFT status", async function () {
      expect(await nft.status()).to.equal(0); // DRAFT
    });

    it("grants all roles to admin", async function () {
      const MINTER   = await nft.MINTER_ROLE();
      const PAUSER   = await nft.PAUSER_ROLE();
      const UPGRADER = await nft.UPGRADER_ROLE();
      const MANAGER  = await nft.MANAGER_ROLE();

      expect(await nft.hasRole(MINTER,   owner.address)).to.be.true;
      expect(await nft.hasRole(PAUSER,   owner.address)).to.be.true;
      expect(await nft.hasRole(UPGRADER, owner.address)).to.be.true;
      expect(await nft.hasRole(MANAGER,  owner.address)).to.be.true;
    });

    it("sets identityVerifier to zero by default", async function () {
      expect(await nft.identityVerifier()).to.equal(ethers.ZeroAddress);
    });

    it("sets linkedERC20 to zero by default", async function () {
      expect(await nft.linkedERC20()).to.equal(ethers.ZeroAddress);
    });

    it("supports ERC-721 interface", async function () {
      // ERC-721 interface ID = 0x80ac58cd
      expect(await nft.supportsInterface("0x80ac58cd")).to.be.true;
    });
  });

  // ─── Minting ──────────────────────────────────────────────────────────────

  describe("minting", function () {
    it("MINTER_ROLE can mint; first tokenId is 1", async function () {
      const tx = await nft.mint(user.address, emptyMeta());
      const receipt = await tx.wait();
      expect(receipt).to.not.be.null;
      // tokenId = 1
      expect(await nft.ownerOf(1)).to.equal(user.address);
    });

    it("second mint returns tokenId 2", async function () {
      await nft.mint(user.address, emptyMeta());
      await nft.mint(user.address, emptyMeta());
      expect(await nft.ownerOf(2)).to.equal(user.address);
    });

    it("stranger cannot mint", async function () {
      await expect(nft.connect(stranger).mint(user.address, emptyMeta()))
        .to.be.reverted;
    });

    it("emits Transfer event on mint", async function () {
      await expect(nft.mint(user.address, emptyMeta()))
        .to.emit(nft, "Transfer")
        .withArgs(ethers.ZeroAddress, user.address, 1n);
    });
  });

  // ─── Identity verifier hook ───────────────────────────────────────────────

  describe("identity verifier hook", function () {
    beforeEach(async function () {
      await nft.setIdentityVerifier(await verifier.getAddress());
    });

    it("blocks mint to unverified address", async function () {
      await expect(nft.mint(user.address, emptyMeta()))
        .to.be.revertedWithCustomError(nft, "NotVerified");
    });

    it("allows mint after verification", async function () {
      await verifier.verifyIdentity(user.address);
      await expect(nft.mint(user.address, emptyMeta())).to.not.be.reverted;
    });

    it("blocks transfer to unverified address", async function () {
      // Verify user to mint, then revoke to block transfer
      await verifier.verifyIdentity(user.address);
      await nft.mint(user.address, emptyMeta());

      await expect(
        nft.connect(user).transferFrom(user.address, stranger.address, 1n)
      ).to.be.revertedWithCustomError(nft, "NotVerified");
    });

    it("allows transfer between verified addresses", async function () {
      await verifier.verifyIdentity(user.address);
      await verifier.verifyIdentity(stranger.address);
      await nft.mint(user.address, emptyMeta());

      await expect(
        nft.connect(user).transferFrom(user.address, stranger.address, 1n)
      ).to.not.be.reverted;

      expect(await nft.ownerOf(1)).to.equal(stranger.address);
    });

    it("emits IdentityVerifierUpdated event", async function () {
      const newVerifier = await (await ethers.getContractFactory("WhitelistVerifier"))
        .deploy(owner.address);
      await expect(nft.setIdentityVerifier(await newVerifier.getAddress()))
        .to.emit(nft, "IdentityVerifierUpdated");
    });
  });

  // ─── Pause / Unpause ──────────────────────────────────────────────────────

  describe("pause / unpause", function () {
    it("PAUSER_ROLE can pause", async function () {
      await expect(nft.pause()).to.not.be.reverted;
    });

    it("transfers are blocked when paused", async function () {
      await verifier.verifyIdentity(user.address);
      await nft.setIdentityVerifier(await verifier.getAddress());
      await nft.mint(user.address, emptyMeta());
      await nft.pause();

      await expect(
        nft.connect(user).transferFrom(user.address, owner.address, 1n)
      ).to.be.reverted;
    });

    it("stranger cannot pause", async function () {
      await expect(nft.connect(stranger).pause()).to.be.reverted;
    });

    it("PAUSER_ROLE can unpause", async function () {
      await nft.pause();
      await expect(nft.unpause()).to.not.be.reverted;
    });
  });

  // ─── Status lifecycle ─────────────────────────────────────────────────────

  describe("status lifecycle", function () {
    it("MANAGER_ROLE can set status", async function () {
      await expect(nft.setStatus(1)).to.not.be.reverted; // ACTIVE
      expect(await nft.status()).to.equal(1);
    });

    it("emits AssetStatusChanged event", async function () {
      await expect(nft.setStatus(1))
        .to.emit(nft, "AssetStatusChanged")
        .withArgs(0n, 1n, (v: bigint) => v > 0n);
    });

    it("stranger cannot set status", async function () {
      await expect(nft.connect(stranger).setStatus(1)).to.be.reverted;
    });
  });

  // ─── linkToERC20 ──────────────────────────────────────────────────────────

  describe("linkToERC20", function () {
    it("MANAGER_ROLE can link an ERC-20 address", async function () {
      const fakeERC20 = user.address;
      await expect(nft.linkToERC20(fakeERC20)).to.not.be.reverted;
      expect(await nft.linkedERC20()).to.equal(fakeERC20);
    });

    it("emits ERC20Linked event", async function () {
      await expect(nft.linkToERC20(user.address))
        .to.emit(nft, "ERC20Linked")
        .withArgs(user.address);
    });

    it("stranger cannot link", async function () {
      await expect(nft.connect(stranger).linkToERC20(user.address)).to.be.reverted;
    });
  });
});
