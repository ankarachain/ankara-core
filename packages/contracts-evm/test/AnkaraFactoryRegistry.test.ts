import { expect } from "chai";
import { ethers } from "hardhat";
import type {
  AnkaraFactoryRegistry,
  TokenFactory,
  NFTFactory,
  MultiTokenFactory,
  EscrowFactory,
} from "../typechain-types";

describe("AnkaraFactoryRegistry", function () {
  let registry: AnkaraFactoryRegistry;
  let erc20Factory: TokenFactory;
  let nftFactory: NFTFactory;
  let multiFactory: MultiTokenFactory;
  let escrowFactory: EscrowFactory;
  let owner: any, deployer: any, stranger: any;

  const FACTORY_TYPE = { ERC20: 0, NFT: 1, MULTI_TOKEN: 2, ESCROW: 3 };

  const SEVEN_DAYS = 7n * 24n * 60n * 60n;
  const ESCROW_AMOUNTS = [100n * 10n ** 18n, 100n * 10n ** 18n];
  const ESCROW_HASHES  = [ethers.ZeroHash, ethers.ZeroHash];

  // Minimal metadata stubs
  const farmMeta = () => ({
    location: "6.52, 3.38", areaSqMeters: 1000n, soilType: "loam",
    irrigationType: "rain-fed", cropHistory: "maize",
    titleDocumentHash: ethers.ZeroHash,
    valuationUSD: 100_000n * 10n ** 18n,
    stateRegion: "Lagos",
    lastUpdated: BigInt(Math.floor(Date.now() / 1000)),
  });

  const warehouseMeta = () => ({
    warehouseId: "WH-001", warehouseLocation: "Lagos",
    operatorAddress: ethers.ZeroAddress, warehouseLicenseHash: ethers.ZeroHash,
    certificationExpiry: BigInt(9_999_999_999),
  });

  const ASSET_ID = ethers.keccak256(ethers.toUtf8Bytes("REGISTRY-TEST"));

  // Stablecoin used to fund test escrows — a plain FarmlandToken standing in as an ERC-20
  const deployStablecoin = async () => {
    const stable = await (await ethers.getContractFactory("FarmlandToken")).deploy();
    await stable.initialize(
      "Mock USD", "mUSD", ethers.keccak256(ethers.toUtf8Bytes("mUSD")), "NG",
      owner.address, ethers.ZeroAddress, owner.address, farmMeta()
    );
    return stable;
  };

  const deployEscrowTx = (caller = deployer, arbiter = ethers.ZeroAddress) =>
    escrowFactory.connect(caller).deployEscrow(
      caller.address, deployer.address, owner.address, arbiter,
      stablecoinAddr, ethers.ZeroAddress, SEVEN_DAYS, ESCROW_AMOUNTS, ESCROW_HASHES
    );

  let stablecoinAddr: string;

  beforeEach(async function () {
    [owner, deployer, stranger] = await ethers.getSigners();

    // Deploy sub-factories
    erc20Factory  = await (await ethers.getContractFactory("TokenFactory"))
      .deploy(owner.address, owner.address) as TokenFactory;
    nftFactory    = await (await ethers.getContractFactory("NFTFactory"))
      .deploy(owner.address, owner.address) as NFTFactory;
    multiFactory  = await (await ethers.getContractFactory("MultiTokenFactory"))
      .deploy(owner.address, owner.address) as MultiTokenFactory;
    escrowFactory = await (await ethers.getContractFactory("EscrowFactory"))
      .deploy(owner.address, owner.address) as EscrowFactory;

    // Register implementations in sub-factories
    await erc20Factory.registerTemplate(0, await (await (await ethers.getContractFactory("FarmlandToken")).deploy()).getAddress());
    await nftFactory.registerTemplate(0,   await (await (await ethers.getContractFactory("FarmlandNFT")).deploy()).getAddress());
    await multiFactory.registerTemplate(0, await (await (await ethers.getContractFactory("CommodityBatchToken")).deploy()).getAddress());
    await multiFactory.registerTemplate(1, await (await (await ethers.getContractFactory("PoolVault")).deploy()).getAddress());
    await escrowFactory.setImplementation(await (await (await ethers.getContractFactory("MilestoneEscrow")).deploy()).getAddress());

    const stablecoin = await deployStablecoin();
    stablecoinAddr = await stablecoin.getAddress();
    await escrowFactory.setStablecoinAccepted(stablecoinAddr, true);

    // Deploy registry and wire up factories
    registry = await (await ethers.getContractFactory("AnkaraFactoryRegistry"))
      .deploy(owner.address) as AnkaraFactoryRegistry;

    await registry.setFactory(FACTORY_TYPE.ERC20,       await erc20Factory.getAddress());
    await registry.setFactory(FACTORY_TYPE.NFT,         await nftFactory.getAddress());
    await registry.setFactory(FACTORY_TYPE.MULTI_TOKEN, await multiFactory.getAddress());
    await registry.setFactory(FACTORY_TYPE.ESCROW,      await escrowFactory.getAddress());
  });

  // ─── Deployment ───────────────────────────────────────────────────────────

  describe("deployment", function () {
    it("sets owner correctly", async function () {
      expect(await registry.owner()).to.equal(owner.address);
    });

    it("all four factory addresses are registered", async function () {
      expect(await registry.getFactory(FACTORY_TYPE.ERC20))
        .to.equal(await erc20Factory.getAddress());
      expect(await registry.getFactory(FACTORY_TYPE.NFT))
        .to.equal(await nftFactory.getAddress());
      expect(await registry.getFactory(FACTORY_TYPE.MULTI_TOKEN))
        .to.equal(await multiFactory.getAddress());
      expect(await registry.getFactory(FACTORY_TYPE.ESCROW))
        .to.equal(await escrowFactory.getAddress());
    });
  });

  // ─── setFactory ───────────────────────────────────────────────────────────

  describe("setFactory", function () {
    it("owner can set a factory address", async function () {
      const newFactory = await (await ethers.getContractFactory("TokenFactory"))
        .deploy(owner.address, owner.address);
      await expect(registry.setFactory(FACTORY_TYPE.ERC20, await newFactory.getAddress()))
        .to.emit(registry, "FactorySet")
        .withArgs(FACTORY_TYPE.ERC20, await newFactory.getAddress());
    });

    it("owner can clear a factory (set to zero address)", async function () {
      await registry.setFactory(FACTORY_TYPE.NFT, ethers.ZeroAddress);
      expect(await registry.getFactory(FACTORY_TYPE.NFT)).to.equal(ethers.ZeroAddress);
    });

    it("stranger cannot set factory", async function () {
      await expect(
        registry.connect(stranger).setFactory(FACTORY_TYPE.ERC20, ethers.ZeroAddress)
      ).to.be.reverted;
    });
  });

  // ─── getFactory ───────────────────────────────────────────────────────────

  describe("getFactory", function () {
    it("returns zero address for unregistered factory type on fresh registry", async function () {
      const freshRegistry = await (await ethers.getContractFactory("AnkaraFactoryRegistry"))
        .deploy(owner.address) as AnkaraFactoryRegistry;
      expect(await freshRegistry.getFactory(FACTORY_TYPE.ERC20)).to.equal(ethers.ZeroAddress);
    });

    it("returns correct address for each factory type", async function () {
      expect(await registry.getFactory(FACTORY_TYPE.ERC20)).to.not.equal(ethers.ZeroAddress);
      expect(await registry.getFactory(FACTORY_TYPE.NFT)).to.not.equal(ethers.ZeroAddress);
      expect(await registry.getFactory(FACTORY_TYPE.MULTI_TOKEN)).to.not.equal(ethers.ZeroAddress);
      expect(await registry.getFactory(FACTORY_TYPE.ESCROW)).to.not.equal(ethers.ZeroAddress);
    });
  });

  // ─── getAllDeployedByAddress ───────────────────────────────────────────────

  describe("getAllDeployedByAddress", function () {
    it("returns empty array when deployer has no deployments", async function () {
      const result = await registry.getAllDeployedByAddress(stranger.address);
      expect(result.length).to.equal(0);
    });

    it("returns ERC-20 tokens deployed by address", async function () {
      await erc20Factory.connect(deployer).deployFarmlandToken(
        "Farm Token", "FT", ASSET_ID, "NG",
        deployer.address, ethers.ZeroAddress, farmMeta()
      );
      const result = await registry.getAllDeployedByAddress(deployer.address);
      expect(result.length).to.equal(1);
    });

    it("returns NFT contracts deployed by address", async function () {
      await nftFactory.connect(deployer).deployFarmlandNFT(
        "Farm NFT", "FNFT", ASSET_ID, "NG", deployer.address, ethers.ZeroAddress
      );
      const result = await registry.getAllDeployedByAddress(deployer.address);
      expect(result.length).to.equal(1);
    });

    it("returns multi-token contracts deployed by address", async function () {
      await multiFactory.connect(deployer).deployCommodityBatchToken(
        "Warehouse", "NG", "ipfs://", deployer.address, warehouseMeta()
      );
      const result = await registry.getAllDeployedByAddress(deployer.address);
      expect(result.length).to.equal(1);
    });

    it("returns escrow contracts deployed by address", async function () {
      await deployEscrowTx(deployer);
      const result = await registry.getAllDeployedByAddress(deployer.address);
      expect(result.length).to.equal(1);
    });

    it("combines deployments across all four factory types for same deployer", async function () {
      await erc20Factory.connect(deployer).deployFarmlandToken(
        "Farm Token", "FT", ASSET_ID, "NG",
        deployer.address, ethers.ZeroAddress, farmMeta()
      );
      await nftFactory.connect(deployer).deployFarmlandNFT(
        "Farm NFT", "FNFT", ASSET_ID, "NG", deployer.address, ethers.ZeroAddress
      );
      await multiFactory.connect(deployer).deployCommodityBatchToken(
        "Warehouse", "NG", "ipfs://", deployer.address, warehouseMeta()
      );
      await deployEscrowTx(deployer);

      const result = await registry.getAllDeployedByAddress(deployer.address);
      expect(result.length).to.equal(4);
    });

    it("returns empty when factories are not set", async function () {
      const freshRegistry = await (await ethers.getContractFactory("AnkaraFactoryRegistry"))
        .deploy(owner.address) as AnkaraFactoryRegistry;
      const result = await freshRegistry.getAllDeployedByAddress(deployer.address);
      expect(result.length).to.equal(0);
    });
  });

  // ─── isAnkaraToken ────────────────────────────────────────────────────────

  describe("isAnkaraToken", function () {
    it("returns false for a random address", async function () {
      expect(await registry.isAnkaraToken(stranger.address)).to.be.false;
    });

    it("returns true for an ERC-20 token deployed via TokenFactory", async function () {
      await erc20Factory.deployFarmlandToken(
        "Farm Token", "FT", ASSET_ID, "NG",
        owner.address, ethers.ZeroAddress, farmMeta()
      );
      const tokens = await erc20Factory.getDeployerTokens(owner.address);
      expect(await registry.isAnkaraToken(tokens[0])).to.be.true;
    });

    it("returns true for an NFT deployed via NFTFactory", async function () {
      await nftFactory.deployFarmlandNFT(
        "Farm NFT", "FNFT", ASSET_ID, "NG", owner.address, ethers.ZeroAddress
      );
      const nfts = await nftFactory.getDeployerNFTs(owner.address);
      expect(await registry.isAnkaraToken(nfts[0])).to.be.true;
    });

    it("returns true for a multi-token deployed via MultiTokenFactory", async function () {
      await multiFactory.deployCommodityBatchToken(
        "Warehouse", "NG", "ipfs://", owner.address, warehouseMeta()
      );
      const multiTokens = await multiFactory.getDeployerMultiTokens(owner.address);
      expect(await registry.isAnkaraToken(multiTokens[0])).to.be.true;
    });

    it("returns true for an escrow deployed via EscrowFactory", async function () {
      await deployEscrowTx(owner);
      const escrows = await escrowFactory.getDeployerEscrows(owner.address);
      expect(await registry.isAnkaraToken(escrows[0])).to.be.true;
    });

    it("returns false when no factories are registered", async function () {
      const freshRegistry = await (await ethers.getContractFactory("AnkaraFactoryRegistry"))
        .deploy(owner.address) as AnkaraFactoryRegistry;
      expect(await freshRegistry.isAnkaraToken(ethers.ZeroAddress)).to.be.false;
    });
  });
});
