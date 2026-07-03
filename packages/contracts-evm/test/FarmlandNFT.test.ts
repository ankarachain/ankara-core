import { expect } from "chai";
import { ethers } from "hardhat";
import type { FarmlandNFT, WhitelistVerifier } from "../typechain-types";

describe("FarmlandNFT", function () {
  let nft: FarmlandNFT;
  let verifier: WhitelistVerifier;
  let owner: any, minter: any, manager: any, user: any, stranger: any;

  const ASSET_ID = ethers.encodeBytes32String("FARM-NG-002");
  const COUNTRY  = "NG";

  const sampleMeta = () => ({
    location: "9.0579°N, 7.4951°E",
    areaSqMeters: 120000n,
    soilType: "loam",
    irrigationType: "borehole",
    cropHistory: "sorghum,millet,fallow",
    titleDocumentHash: ethers.encodeBytes32String("ipfs-title-cid"),
    surveyReportHash:  ethers.encodeBytes32String("ipfs-survey-cid"),
    stateRegion: "Abuja FCT",
    lastUpdated: 0n,
  });

  beforeEach(async function () {
    [owner, minter, manager, user, stranger] = await ethers.getSigners();

    verifier = await (await ethers.getContractFactory("WhitelistVerifier"))
      .deploy(owner.address);

    const Impl = await ethers.getContractFactory("FarmlandNFT");
    nft = (await Impl.deploy()) as FarmlandNFT;
    await nft.initialize("Farmland Deed", "FDEED", ASSET_ID, COUNTRY, owner.address, ethers.ZeroAddress);
  });

  // ─── Initialization ───────────────────────────────────────────────────────

  describe("initialization", function () {
    it("sets name, symbol, assetId, countryCode", async function () {
      expect(await nft.name()).to.equal("Farmland Deed");
      expect(await nft.symbol()).to.equal("FDEED");
      expect(await nft.assetId()).to.equal(ASSET_ID);
      expect(await nft.countryCode()).to.equal(COUNTRY);
    });

    it("starts with DRAFT status", async function () {
      expect(await nft.status()).to.equal(0);
    });
  });

  // ─── Minting ──────────────────────────────────────────────────────────────

  describe("mint", function () {
    it("returns tokenId 1 for first mint", async function () {
      const tx = await nft.mint(user.address, sampleMeta());
      await tx.wait();
      expect(await nft.ownerOf(1)).to.equal(user.address);
    });

    it("stores metadata on mint", async function () {
      await nft.mint(user.address, sampleMeta());
      const meta = await nft.getMetadata(1);
      expect(meta.location).to.equal("9.0579°N, 7.4951°E");
      expect(meta.areaSqMeters).to.equal(120000n);
      expect(meta.soilType).to.equal("loam");
      expect(meta.stateRegion).to.equal("Abuja FCT");
    });

    it("sets lastUpdated to block timestamp on mint", async function () {
      const before = BigInt(Math.floor(Date.now() / 1000)) - 5n;
      await nft.mint(user.address, sampleMeta());
      const meta = await nft.getMetadata(1);
      expect(meta.lastUpdated).to.be.greaterThan(before);
    });

    it("sets metadataVersion to 1 on mint", async function () {
      await nft.mint(user.address, sampleMeta());
      expect(await nft.metadataVersion(1)).to.equal(1n);
    });

    it("emits FarmlandNFTMinted event", async function () {
      await expect(nft.mint(user.address, sampleMeta()))
        .to.emit(nft, "FarmlandNFTMinted")
        .withArgs(1n, user.address, ASSET_ID);
    });

    it("emits MetadataUpdated event on mint", async function () {
      await expect(nft.mint(user.address, sampleMeta()))
        .to.emit(nft, "MetadataUpdated")
        .withArgs(1n, 1n, (v: bigint) => v > 0n);
    });

    it("increments tokenId for each mint", async function () {
      await nft.mint(user.address, sampleMeta());
      await nft.mint(user.address, sampleMeta());
      await nft.mint(user.address, sampleMeta());
      expect(await nft.ownerOf(3)).to.equal(user.address);
    });

    it("stranger cannot mint", async function () {
      await expect(nft.connect(stranger).mint(user.address, sampleMeta()))
        .to.be.reverted;
    });
  });

  // ─── getMetadata ──────────────────────────────────────────────────────────

  describe("getMetadata", function () {
    it("returns correct metadata for a tokenId", async function () {
      await nft.mint(user.address, sampleMeta());
      const meta = await nft.getMetadata(1);
      expect(meta.titleDocumentHash).to.equal(ethers.encodeBytes32String("ipfs-title-cid"));
      expect(meta.surveyReportHash).to.equal(ethers.encodeBytes32String("ipfs-survey-cid"));
    });
  });

  // ─── updateMetadata ───────────────────────────────────────────────────────

  describe("updateMetadata", function () {
    beforeEach(async function () {
      await nft.mint(user.address, sampleMeta());
    });

    it("MANAGER_ROLE can update metadata", async function () {
      const updated = { ...sampleMeta(), soilType: "clay" };
      await expect(nft.updateMetadata(1, updated)).to.not.be.reverted;
      const meta = await nft.getMetadata(1);
      expect(meta.soilType).to.equal("clay");
    });

    it("increments metadataVersion on update", async function () {
      await nft.updateMetadata(1, sampleMeta());
      expect(await nft.metadataVersion(1)).to.equal(2n);
    });

    it("emits MetadataUpdated event", async function () {
      await expect(nft.updateMetadata(1, sampleMeta()))
        .to.emit(nft, "MetadataUpdated")
        .withArgs(1n, 2n, (v: bigint) => v > 0n);
    });

    it("updates lastUpdated to block timestamp", async function () {
      const before = BigInt(Math.floor(Date.now() / 1000)) - 5n;
      await nft.updateMetadata(1, sampleMeta());
      const meta = await nft.getMetadata(1);
      expect(meta.lastUpdated).to.be.greaterThan(before);
    });

    it("stranger cannot update metadata", async function () {
      await expect(nft.connect(stranger).updateMetadata(1, sampleMeta()))
        .to.be.reverted;
    });
  });

  // ─── updateTitleDocument ──────────────────────────────────────────────────

  describe("updateTitleDocument", function () {
    beforeEach(async function () {
      await nft.mint(user.address, sampleMeta());
    });

    it("MANAGER_ROLE can update title document hash", async function () {
      const newHash = ethers.encodeBytes32String("new-title-cid");
      await nft.updateTitleDocument(1, newHash);
      const meta = await nft.getMetadata(1);
      expect(meta.titleDocumentHash).to.equal(newHash);
    });

    it("increments metadataVersion", async function () {
      const newHash = ethers.encodeBytes32String("new-cid");
      await nft.updateTitleDocument(1, newHash);
      expect(await nft.metadataVersion(1)).to.equal(2n);
    });

    it("stranger cannot update title document", async function () {
      await expect(nft.connect(stranger).updateTitleDocument(1, ethers.ZeroHash))
        .to.be.reverted;
    });
  });

  // ─── linkToERC20 ──────────────────────────────────────────────────────────

  describe("linkToERC20", function () {
    it("stores the linked ERC-20 address", async function () {
      await nft.linkToERC20(user.address);
      expect(await nft.linkedERC20()).to.equal(user.address);
    });

    it("emits ERC20Linked event", async function () {
      await expect(nft.linkToERC20(user.address))
        .to.emit(nft, "ERC20Linked")
        .withArgs(user.address);
    });
  });

  // ─── Burning ──────────────────────────────────────────────────────────────

  describe("burning", function () {
    it("token owner can burn their token", async function () {
      await nft.mint(user.address, sampleMeta());
      await expect(nft.connect(user).burn(1)).to.not.be.reverted;
      await expect(nft.ownerOf(1)).to.be.reverted;
    });
  });
});
