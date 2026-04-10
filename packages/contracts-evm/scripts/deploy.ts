import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "MATIC");

  // 1. Deploy WhitelistVerifier (testing only)
  console.log("\n1. Deploying WhitelistVerifier...");
  const WhitelistVerifier = await ethers.getContractFactory("WhitelistVerifier");
  const verifier = await WhitelistVerifier.deploy(deployer.address);
  await verifier.waitForDeployment();
  console.log("   WhitelistVerifier:", await verifier.getAddress());

  // 2. Deploy FarmlandToken implementation
  console.log("\n2. Deploying FarmlandToken implementation...");
  const FarmlandToken = await ethers.getContractFactory("FarmlandToken");
  const farmlandImpl = await FarmlandToken.deploy();
  await farmlandImpl.waitForDeployment();
  console.log("   FarmlandToken impl:", await farmlandImpl.getAddress());

  // 3. Deploy CommodityReceiptToken implementation
  console.log("\n3. Deploying CommodityReceiptToken implementation...");
  const CommodityReceiptToken = await ethers.getContractFactory("CommodityReceiptToken");
  const commodityImpl = await CommodityReceiptToken.deploy();
  await commodityImpl.waitForDeployment();
  console.log("   CommodityReceiptToken impl:", await commodityImpl.getAddress());

  // 4. Deploy TokenFactory
  console.log("\n4. Deploying TokenFactory...");
  const TokenFactory = await ethers.getContractFactory("TokenFactory");
  const factory = await TokenFactory.deploy(deployer.address, deployer.address);
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log("   TokenFactory:", factoryAddress);

  // 5. Register templates
  console.log("\n5. Registering templates...");
  await (await factory.registerTemplate(0, await farmlandImpl.getAddress())).wait();
  console.log("   FARMLAND registered");
  await (await factory.registerTemplate(1, await commodityImpl.getAddress())).wait();
  console.log("   COMMODITY_RECEIPT registered");

  // 6. Test deployment — mint a Farmland token
  console.log("\n6. Deploying test FarmlandToken via factory...");
  const assetId = ethers.keccak256(ethers.toUtf8Bytes("KANO-FARM-001"));
  const now = Math.floor(Date.now() / 1000);

  const tx = await factory.deployFarmlandToken(
    "Kano Farmland Token",
    "KFT",
    assetId,
    "NG",
    deployer.address,
    ethers.ZeroAddress, // No KYC on testnet
    {
      location: "12.0022, 8.5919",
      areaSqMeters: 50000n,
      soilType: "loam",
      irrigationType: "rain-fed",
      cropHistory: "maize,sorghum,fallow",
      titleDocumentHash: ethers.ZeroHash,
      valuationUSD: ethers.parseEther("125000"),
      stateRegion: "Kano State",
      lastUpdated: BigInt(now),
    }
  );

  const receipt = await tx.wait();
  console.log("   FarmlandToken deployed in tx:", receipt?.hash);

  const deployed = await factory.getDeployerTokens(deployer.address);
  console.log("   Token address:", deployed[0]);

  console.log("\n✅ Ankara Chain deployed to Polygon Amoy.");
  console.log("─".repeat(50));
  console.log("WhitelistVerifier: ", await verifier.getAddress());
  console.log("FarmlandToken impl:", await farmlandImpl.getAddress());
  console.log("CommodityReceipt: ", await commodityImpl.getAddress());
  console.log("TokenFactory:     ", factoryAddress);
  console.log("Test KFT token:   ", deployed[0]);
  console.log("─".repeat(50));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
