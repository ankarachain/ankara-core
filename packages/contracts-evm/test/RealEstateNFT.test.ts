import { expect } from "chai";
import { ethers } from "hardhat";
import type { RealEstateNFT } from "../typechain-types";

describe("RealEstateNFT", function () {
  let nft: RealEstateNFT;
  let owner: any, user: any, stranger: any;

  const ASSET_ID = ethers.encodeBytes32String("REALESTATE-NG-001");
  const COUNTRY  = "NG";

  const sampleMeta = () => ({
    propertyId: "ABUJA-FCT-00123",
    propertyType: "Commercial",
    locationAddress: "Plot 5, Central Business District, Abuja",
    totalAreaSqMeters: 2500n,
    titleDocumentHash: ethers.encodeBytes32String("ipfs-title-cid"),
    valuationUSD: ethers.parseEther("500000"),
    rentalYieldBps: 800n, // 8%
    developerAddress: ethers.ZeroAddress,
    lastUpdated: 0n,
  });

  beforeEach(async function () {
    [owner, user, stranger] = await ethers.getSigners();

    const Impl = await ethers.getContractFactory("RealEstateNFT");
    nft = (await Impl.deploy()) as RealEstateNFT;
    await nft.initialize("RE Deed", "REDEED", ASSET_ID, COUNTRY, owner.address, ethers.ZeroAddress);
  });

  // ─── Initialization ───────────────────────────────────────────────────────

  describe("initialization", function () {
    it("sets name and symbol", async function () {
      expect(await nft.name()).to.equal("RE Deed");
      expect(await nft.symbol()).to.equal("REDEED");
    });

    it("sets assetId and countryCode", async function () {
      expect(await nft.assetId()).to.equal(ASSET_ID);
      expect(await nft.countryCode()).to.equal(COUNTRY);
    });
  });

  // ─── Minting ──────────────────────────────────────────────────────────────

  describe("mint", function () {
    it("returns tokenId 1 for first mint and stores metadata", async function () {
      await nft.mint(user.address, sampleMeta());
      expect(await nft.ownerOf(1)).to.equal(user.address);

      const meta = await nft.getMetadata(1);
      expect(meta.propertyId).to.equal("ABUJA-FCT-00123");
      expect(meta.propertyType).to.equal("Commercial");
      expect(meta.valuationUSD).to.equal(ethers.parseEther("500000"));
    });

    it("sets metadataVersion to 1 on mint", async function () {
      await nft.mint(user.address, sampleMeta());
      expect(await nft.metadataVersion(1)).to.equal(1n);
    });

    it("emits RealEstateNFTMinted event", async function () {
      await expect(nft.mint(user.address, sampleMeta()))
        .to.emit(nft, "RealEstateNFTMinted")
        .withArgs(1n, user.address, ASSET_ID);
    });

    it("stranger cannot mint", async function () {
      await expect(nft.connect(stranger).mint(user.address, sampleMeta()))
        .to.be.reverted;
    });
  });

  // ─── updateMetadata ───────────────────────────────────────────────────────

  describe("updateMetadata", function () {
    beforeEach(async function () {
      await nft.mint(user.address, sampleMeta());
    });

    it("MANAGER_ROLE can update metadata", async function () {
      const updated = { ...sampleMeta(), propertyType: "Residential" };
      await nft.updateMetadata(1, updated);
      const meta = await nft.getMetadata(1);
      expect(meta.propertyType).to.equal("Residential");
    });

    it("increments metadataVersion", async function () {
      await nft.updateMetadata(1, sampleMeta());
      expect(await nft.metadataVersion(1)).to.equal(2n);
    });

    it("emits ValuationUpdated event when valuation changes", async function () {
      const updated = { ...sampleMeta(), valuationUSD: ethers.parseEther("600000") };
      await expect(nft.updateMetadata(1, updated))
        .to.emit(nft, "ValuationUpdated")
        .withArgs(1n, ethers.parseEther("500000"), ethers.parseEther("600000"), (v: bigint) => v > 0n);
    });

    it("does not emit ValuationUpdated when valuation unchanged", async function () {
      const tx = await nft.updateMetadata(1, sampleMeta());
      const receipt = await tx.wait();
      const logs = receipt!.logs.filter((l: any) => {
        try { return nft.interface.parseLog(l)?.name === "ValuationUpdated"; } catch { return false; }
      });
      expect(logs.length).to.equal(0);
    });

    it("stranger cannot update metadata", async function () {
      await expect(nft.connect(stranger).updateMetadata(1, sampleMeta()))
        .to.be.reverted;
    });
  });

  // ─── updateValuation ──────────────────────────────────────────────────────

  describe("updateValuation", function () {
    beforeEach(async function () {
      await nft.mint(user.address, sampleMeta());
    });

    it("MANAGER_ROLE can update valuation", async function () {
      await nft.updateValuation(1, ethers.parseEther("750000"));
      const meta = await nft.getMetadata(1);
      expect(meta.valuationUSD).to.equal(ethers.parseEther("750000"));
    });

    it("emits ValuationUpdated event", async function () {
      await expect(nft.updateValuation(1, ethers.parseEther("750000")))
        .to.emit(nft, "ValuationUpdated")
        .withArgs(1n, ethers.parseEther("500000"), ethers.parseEther("750000"), (v: bigint) => v > 0n);
    });

    it("increments metadataVersion on updateValuation", async function () {
      await nft.updateValuation(1, ethers.parseEther("750000"));
      expect(await nft.metadataVersion(1)).to.equal(2n);
    });

    it("stranger cannot update valuation", async function () {
      await expect(nft.connect(stranger).updateValuation(1, ethers.parseEther("750000")))
        .to.be.reverted;
    });
  });
});
