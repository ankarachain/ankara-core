import { expect } from "chai";
import { ethers } from "hardhat";
import type { MiningRightsNFT } from "../typechain-types";

describe("MiningRightsNFT", function () {
  let nft: MiningRightsNFT;
  let owner: any, user: any, stranger: any;

  const ASSET_ID = ethers.encodeBytes32String("MINE-GH-001");
  const COUNTRY  = "GH";

  const now = () => BigInt(Math.floor(Date.now() / 1000));
  const days = (n: number) => BigInt(n * 24 * 60 * 60);

  const sampleMeta = () => ({
    licenseNumber: "GH-MINE-2024-0042",
    mineralType: "gold",
    concessionArea: "Obuasi Block 7",
    areaHectares: 500n,
    licenseExpiry: now() + days(365),
    issuingAuthority: "Ghana Minerals Commission",
    licenseDocumentHash: ethers.encodeBytes32String("ipfs-license-cid"),
    royaltyRateBps: 500n, // 5%
    lastUpdated: 0n,
  });

  beforeEach(async function () {
    [owner, user, stranger] = await ethers.getSigners();

    const Impl = await ethers.getContractFactory("MiningRightsNFT");
    nft = (await Impl.deploy()) as MiningRightsNFT;
    await nft.initialize("Mining License", "MINE", ASSET_ID, COUNTRY, owner.address, ethers.ZeroAddress);
  });

  // ─── Initialization ───────────────────────────────────────────────────────

  describe("initialization", function () {
    it("sets name, symbol, assetId, countryCode", async function () {
      expect(await nft.name()).to.equal("Mining License");
      expect(await nft.symbol()).to.equal("MINE");
      expect(await nft.assetId()).to.equal(ASSET_ID);
      expect(await nft.countryCode()).to.equal(COUNTRY);
    });
  });

  // ─── Minting ──────────────────────────────────────────────────────────────

  describe("mint", function () {
    it("mints tokenId 1 and stores metadata", async function () {
      await nft.mint(user.address, sampleMeta());
      expect(await nft.ownerOf(1)).to.equal(user.address);

      const meta = await nft.getMetadata(1);
      expect(meta.licenseNumber).to.equal("GH-MINE-2024-0042");
      expect(meta.mineralType).to.equal("gold");
      expect(meta.royaltyRateBps).to.equal(500n);
    });

    it("sets metadataVersion to 1 on mint", async function () {
      await nft.mint(user.address, sampleMeta());
      expect(await nft.metadataVersion(1)).to.equal(1n);
    });

    it("emits MiningRightsNFTMinted event", async function () {
      await expect(nft.mint(user.address, sampleMeta()))
        .to.emit(nft, "MiningRightsNFTMinted")
        .withArgs(1n, user.address, ASSET_ID);
    });

    it("stranger cannot mint", async function () {
      await expect(nft.connect(stranger).mint(user.address, sampleMeta()))
        .to.be.reverted;
    });
  });

  // ─── isLicenseExpired ─────────────────────────────────────────────────────

  describe("isLicenseExpired", function () {
    it("returns false for a future expiry", async function () {
      await nft.mint(user.address, sampleMeta());
      expect(await nft.isLicenseExpired(1)).to.be.false;
    });

    it("returns true for a past expiry", async function () {
      const pastMeta = { ...sampleMeta(), licenseExpiry: now() - days(1) };
      await nft.mint(user.address, pastMeta);
      expect(await nft.isLicenseExpired(1)).to.be.true;
    });
  });

  // ─── renewLicense ─────────────────────────────────────────────────────────

  describe("renewLicense", function () {
    beforeEach(async function () {
      await nft.mint(user.address, sampleMeta());
    });

    it("MANAGER_ROLE can renew license", async function () {
      const newExpiry = now() + days(730);
      await nft.renewLicense(1, newExpiry);
      const meta = await nft.getMetadata(1);
      expect(meta.licenseExpiry).to.equal(newExpiry);
    });

    it("emits LicenseRenewed event", async function () {
      const oldExpiry = (await nft.getMetadata(1)).licenseExpiry;
      const newExpiry = now() + days(730);
      await expect(nft.renewLicense(1, newExpiry))
        .to.emit(nft, "LicenseRenewed")
        .withArgs(1n, oldExpiry, newExpiry);
    });

    it("increments metadataVersion on renewLicense", async function () {
      await nft.renewLicense(1, now() + days(730));
      expect(await nft.metadataVersion(1)).to.equal(2n);
    });

    it("stranger cannot renew license", async function () {
      await expect(nft.connect(stranger).renewLicense(1, now() + days(730)))
        .to.be.reverted;
    });
  });

  // ─── updateMetadata ───────────────────────────────────────────────────────

  describe("updateMetadata", function () {
    beforeEach(async function () {
      await nft.mint(user.address, sampleMeta());
    });

    it("MANAGER_ROLE can update metadata", async function () {
      const updated = { ...sampleMeta(), mineralType: "lithium" };
      await nft.updateMetadata(1, updated);
      const meta = await nft.getMetadata(1);
      expect(meta.mineralType).to.equal("lithium");
    });

    it("increments metadataVersion", async function () {
      await nft.updateMetadata(1, sampleMeta());
      expect(await nft.metadataVersion(1)).to.equal(2n);
    });

    it("stranger cannot update metadata", async function () {
      await expect(nft.connect(stranger).updateMetadata(1, sampleMeta()))
        .to.be.reverted;
    });
  });
});
