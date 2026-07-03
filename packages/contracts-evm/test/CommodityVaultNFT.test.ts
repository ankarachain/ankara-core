import { expect } from "chai";
import { ethers } from "hardhat";
import type { CommodityVaultNFT } from "../typechain-types";

describe("CommodityVaultNFT", function () {
  let nft: CommodityVaultNFT;
  let owner: any, user: any, stranger: any;

  const ASSET_ID = ethers.encodeBytes32String("COMM-KE-001");
  const COUNTRY  = "KE";

  const now = () => BigInt(Math.floor(Date.now() / 1000));

  const sampleMeta = () => ({
    warehouseId: "KE-WH-NRB-007",
    warehouseLocation: "Nairobi Industrial Area, Gate 7",
    operatorAddress: ethers.ZeroAddress,
    commodityType: "coffee",
    quantityKg: 10000n,
    gradeClassification: "AA",
    certificateHash: ethers.encodeBytes32String("ipfs-cert-cid"),
    depositDate: now(),
    lastUpdated: 0n,
  });

  beforeEach(async function () {
    [owner, user, stranger] = await ethers.getSigners();

    const Impl = await ethers.getContractFactory("CommodityVaultNFT");
    nft = (await Impl.deploy()) as CommodityVaultNFT;
    await nft.initialize("Coffee Vault", "CVLT", ASSET_ID, COUNTRY, owner.address, ethers.ZeroAddress);
  });

  // ─── Initialization ───────────────────────────────────────────────────────

  describe("initialization", function () {
    it("sets name, symbol, assetId, countryCode", async function () {
      expect(await nft.name()).to.equal("Coffee Vault");
      expect(await nft.symbol()).to.equal("CVLT");
      expect(await nft.assetId()).to.equal(ASSET_ID);
      expect(await nft.countryCode()).to.equal(COUNTRY);
    });

    it("starts with DRAFT status", async function () {
      expect(await nft.status()).to.equal(0);
    });
  });

  // ─── Minting ──────────────────────────────────────────────────────────────

  describe("mint", function () {
    it("mints tokenId 1 and stores metadata", async function () {
      await nft.mint(user.address, sampleMeta());
      expect(await nft.ownerOf(1)).to.equal(user.address);

      const meta = await nft.getMetadata(1);
      expect(meta.warehouseId).to.equal("KE-WH-NRB-007");
      expect(meta.commodityType).to.equal("coffee");
      expect(meta.quantityKg).to.equal(10000n);
      expect(meta.gradeClassification).to.equal("AA");
    });

    it("sets metadataVersion to 1 on mint", async function () {
      await nft.mint(user.address, sampleMeta());
      expect(await nft.metadataVersion(1)).to.equal(1n);
    });

    it("sets lastUpdated to block timestamp on mint", async function () {
      const before = BigInt(Math.floor(Date.now() / 1000)) - 5n;
      await nft.mint(user.address, sampleMeta());
      const meta = await nft.getMetadata(1);
      expect(meta.lastUpdated).to.be.greaterThan(before);
    });

    it("emits CommodityVaultNFTMinted event", async function () {
      await expect(nft.mint(user.address, sampleMeta()))
        .to.emit(nft, "CommodityVaultNFTMinted")
        .withArgs(1n, user.address, ASSET_ID);
    });

    it("emits MetadataUpdated event on mint", async function () {
      await expect(nft.mint(user.address, sampleMeta()))
        .to.emit(nft, "MetadataUpdated")
        .withArgs(1n, 1n, (v: bigint) => v > 0n);
    });

    it("increments tokenId for sequential mints", async function () {
      await nft.mint(user.address, sampleMeta());
      await nft.mint(user.address, sampleMeta());
      expect(await nft.ownerOf(2)).to.equal(user.address);
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
      const updated = { ...sampleMeta(), commodityType: "cocoa", quantityKg: 8000n };
      await nft.updateMetadata(1, updated);
      const meta = await nft.getMetadata(1);
      expect(meta.commodityType).to.equal("cocoa");
      expect(meta.quantityKg).to.equal(8000n);
    });

    it("increments metadataVersion on update", async function () {
      await nft.updateMetadata(1, sampleMeta());
      expect(await nft.metadataVersion(1)).to.equal(2n);
    });

    it("emits MetadataUpdated with new version", async function () {
      await expect(nft.updateMetadata(1, sampleMeta()))
        .to.emit(nft, "MetadataUpdated")
        .withArgs(1n, 2n, (v: bigint) => v > 0n);
    });

    it("updates lastUpdated on metadata update", async function () {
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

  // ─── linkToERC20 ──────────────────────────────────────────────────────────

  describe("linkToERC20", function () {
    it("MANAGER_ROLE can link ERC-20 token", async function () {
      await nft.linkToERC20(user.address);
      expect(await nft.linkedERC20()).to.equal(user.address);
    });

    it("stranger cannot link", async function () {
      await expect(nft.connect(stranger).linkToERC20(user.address)).to.be.reverted;
    });
  });
});
