import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  console.log("Balance:", ethers.formatEther(
    await ethers.provider.getBalance(deployer.address)
  ), "MATIC\n");

  // 1. Deploy WhitelistVerifier
  console.log("1. WhitelistVerifier...");
  const verifier = await (await ethers.getContractFactory("WhitelistVerifier"))
    .deploy(deployer.address);
  await verifier.waitForDeployment();
  console.log("   ✓", await verifier.getAddress());

  // 2-7. Deploy all 6 token implementations
  const templates = [
    "FarmlandToken",
    "CommodityReceiptToken",
    "RealEstateToken",
    "InvoiceToken",
    "CarbonCreditToken",
    "MiningRightsToken",
  ];

  const impls: Record<string, string> = {};
  for (let i = 0; i < templates.length; i++) {
    console.log(`${i + 2}. ${templates[i]}...`);
    const impl = await (await ethers.getContractFactory(templates[i])).deploy();
    await impl.waitForDeployment();
    impls[templates[i]] = await impl.getAddress();
    console.log("   ✓", impls[templates[i]]);
  }

  // 8. Deploy TokenFactory
  console.log("\n8. TokenFactory...");
  const factory = await (await ethers.getContractFactory("TokenFactory"))
    .deploy(deployer.address, deployer.address);
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log("   ✓", factoryAddress);

  // 9. Register all 6 templates
  console.log("\n9. Registering templates...");
  for (let i = 0; i < templates.length; i++) {
    await (await factory.registerTemplate(i, impls[templates[i]])).wait();
    console.log(`   ✓ ${templates[i]} → template ${i}`);
  }

  // 10. Test deploy one of each
  console.log("\n10. Test deployments...");
  const now = BigInt(Math.floor(Date.now() / 1000));

  // Farmland
  const farmTx = await factory.deployFarmlandToken(
    "Kano Farmland Token", "KFT",
    ethers.keccak256(ethers.toUtf8Bytes("KANO-FARM-001")),
    "NG", deployer.address, ethers.ZeroAddress,
    {
      location: "12.0022, 8.5919",
      areaSqMeters: 50000n,
      soilType: "loam",
      irrigationType: "rain-fed",
      cropHistory: "maize,sorghum,fallow",
      titleDocumentHash: ethers.ZeroHash,
      valuationUSD: ethers.parseEther("125000"),
      stateRegion: "Kano State",
      lastUpdated: now,
    }
  );
  await farmTx.wait();
  console.log("   ✓ FarmlandToken deployed");

  // Carbon Credit
  const carbonTx = await factory.deployCarbonCreditToken(
    "DRC Forest Carbon Credit", "DRCC",
    ethers.keccak256(ethers.toUtf8Bytes("DRC-REDD-001")),
    "CD", deployer.address, ethers.ZeroAddress,
    {
      creditType: "REDD+",
      verificationBodyRef: "VERRA-VCS-2024-001",
      vintageYear: 2024n,
      quantityCO2e: ethers.parseEther("10000"),
      projectLocation: "-4.0383, 21.7587",
      projectType: "Forestry",
      verificationDocHash: ethers.ZeroHash,
      lastUpdated: now,
    }
  );
  await carbonTx.wait();
  console.log("   ✓ CarbonCreditToken deployed");

  // Mining Rights
  const miningTx = await factory.deployMiningRightsToken(
    "Zambia Copper Rights", "ZCR",
    ethers.keccak256(ethers.toUtf8Bytes("ZM-COPPER-001")),
    "ZM", deployer.address, ethers.ZeroAddress,
    {
      licenseNumber: "ZM-MIN-2024-0042",
      mineralType: "Copper",
      concessionArea: "-13.1339, 27.8493",
      areaHectares: 500n,
      licenseExpiry: now + BigInt(60 * 60 * 24 * 365 * 5),
      issuingAuthority: "Zambia Mining Cadastre Office",
      licenseDocumentHash: ethers.ZeroHash,
      royaltyRateBps: 250n,
      lastUpdated: now,
    }
  );
  await miningTx.wait();
  console.log("   ✓ MiningRightsToken deployed");

  const deployed = await factory.getDeployerTokens(deployer.address);

  // 11. Deploy NFT templates (FarmlandNFT, RealEstateNFT, MiningRightsNFT, CommodityVaultNFT)
  console.log("\n11. NFT templates...");
  const nftTemplates = [
    "FarmlandNFT",
    "RealEstateNFT",
    "MiningRightsNFT",
    "CommodityVaultNFT",
  ];
  const nftImpls: Record<string, string> = {};
  for (let i = 0; i < nftTemplates.length; i++) {
    const impl = await (await ethers.getContractFactory(nftTemplates[i])).deploy();
    await impl.waitForDeployment();
    nftImpls[nftTemplates[i]] = await impl.getAddress();
    console.log(`   ✓ ${nftTemplates[i]}`, nftImpls[nftTemplates[i]]);
  }

  // 12. Deploy NFTFactory; register the 4 NFT templates
  console.log("\n12. NFTFactory...");
  const nftFactory = await (await ethers.getContractFactory("NFTFactory"))
    .deploy(deployer.address, deployer.address);
  await nftFactory.waitForDeployment();
  const nftFactoryAddress = await nftFactory.getAddress();
  console.log("   ✓", nftFactoryAddress);
  for (let i = 0; i < nftTemplates.length; i++) {
    await (await nftFactory.registerTemplate(i, nftImpls[nftTemplates[i]])).wait();
    console.log(`   ✓ ${nftTemplates[i]} → template ${i}`);
  }

  // 13. Deploy MultiToken templates (CommodityBatchToken, PoolVault)
  console.log("\n13. MultiToken templates...");
  const multiTokenTemplates = ["CommodityBatchToken", "PoolVault"];
  const multiTokenImpls: Record<string, string> = {};
  for (let i = 0; i < multiTokenTemplates.length; i++) {
    const impl = await (await ethers.getContractFactory(multiTokenTemplates[i])).deploy();
    await impl.waitForDeployment();
    multiTokenImpls[multiTokenTemplates[i]] = await impl.getAddress();
    console.log(`   ✓ ${multiTokenTemplates[i]}`, multiTokenImpls[multiTokenTemplates[i]]);
  }

  // 14. Deploy MultiTokenFactory; register CommodityBatchToken + PoolVault
  console.log("\n14. MultiTokenFactory...");
  const multiTokenFactory = await (await ethers.getContractFactory("MultiTokenFactory"))
    .deploy(deployer.address, deployer.address);
  await multiTokenFactory.waitForDeployment();
  const multiTokenFactoryAddress = await multiTokenFactory.getAddress();
  console.log("   ✓", multiTokenFactoryAddress);
  for (let i = 0; i < multiTokenTemplates.length; i++) {
    await (await multiTokenFactory.registerTemplate(i, multiTokenImpls[multiTokenTemplates[i]])).wait();
    console.log(`   ✓ ${multiTokenTemplates[i]} → template ${i}`);
  }

  // 15. Deploy MilestoneEscrow implementation + EscrowFactory
  //     NOTE: deployEscrow() will revert with StablecoinNotAccepted until
  //     setStablecoinAccepted(token, true) is called for a real stablecoin —
  //     no mock ERC-20 exists in this repo, so that call and a live test
  //     escrow deployment are intentionally skipped here.
  console.log("\n15. MilestoneEscrow + EscrowFactory...");
  const escrowImpl = await (await ethers.getContractFactory("MilestoneEscrow")).deploy();
  await escrowImpl.waitForDeployment();
  const escrowImplAddress = await escrowImpl.getAddress();
  console.log("   ✓ MilestoneEscrow impl", escrowImplAddress);
  const escrowFactory = await (await ethers.getContractFactory("EscrowFactory"))
    .deploy(deployer.address, deployer.address);
  await escrowFactory.waitForDeployment();
  const escrowFactoryAddress = await escrowFactory.getAddress();
  console.log("   ✓ EscrowFactory", escrowFactoryAddress);
  await (await escrowFactory.setImplementation(escrowImplAddress)).wait();
  console.log("   ✓ implementation set");

  // 16. Deploy RampSettlement implementation + RampSettlementFactory
  console.log("\n16. RampSettlement + RampSettlementFactory...");
  const rampImpl = await (await ethers.getContractFactory("RampSettlement")).deploy();
  await rampImpl.waitForDeployment();
  const rampImplAddress = await rampImpl.getAddress();
  console.log("   ✓ RampSettlement impl", rampImplAddress);
  const rampFactory = await (await ethers.getContractFactory("RampSettlementFactory"))
    .deploy(deployer.address, deployer.address);
  await rampFactory.waitForDeployment();
  const rampFactoryAddress = await rampFactory.getAddress();
  console.log("   ✓ RampSettlementFactory", rampFactoryAddress);
  await (await rampFactory.setImplementation(rampImplAddress)).wait();
  console.log("   ✓ implementation set");

  // 17. Deploy AnkaraFactoryRegistry; register all 5 sub-factories
  console.log("\n17. AnkaraFactoryRegistry...");
  const registry = await (await ethers.getContractFactory("AnkaraFactoryRegistry"))
    .deploy(deployer.address);
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log("   ✓", registryAddress);
  const FactoryType = { ERC20: 0, NFT: 1, MULTI_TOKEN: 2, ESCROW: 3, RAMP: 4 };
  await (await registry.setFactory(FactoryType.ERC20, factoryAddress)).wait();
  await (await registry.setFactory(FactoryType.NFT, nftFactoryAddress)).wait();
  await (await registry.setFactory(FactoryType.MULTI_TOKEN, multiTokenFactoryAddress)).wait();
  await (await registry.setFactory(FactoryType.ESCROW, escrowFactoryAddress)).wait();
  await (await registry.setFactory(FactoryType.RAMP, rampFactoryAddress)).wait();
  console.log("   ✓ 5 sub-factories registered");

  console.log("\n" + "─".repeat(54));
  console.log("✅  Ankara Chain — full suite deployed");
  console.log("─".repeat(54));
  console.log("WhitelistVerifier:       ", await verifier.getAddress());
  templates.forEach((t, i) => {
    console.log(`${t.padEnd(25)}`, impls[t]);
  });
  console.log("TokenFactory:            ", factoryAddress);
  nftTemplates.forEach((t) => {
    console.log(`${t.padEnd(25)}`, nftImpls[t]);
  });
  console.log("NFTFactory:              ", nftFactoryAddress);
  multiTokenTemplates.forEach((t) => {
    console.log(`${t.padEnd(25)}`, multiTokenImpls[t]);
  });
  console.log("MultiTokenFactory:       ", multiTokenFactoryAddress);
  console.log("MilestoneEscrow impl:    ", escrowImplAddress);
  console.log("EscrowFactory:           ", escrowFactoryAddress);
  console.log("RampSettlement impl:     ", rampImplAddress);
  console.log("RampSettlementFactory:   ", rampFactoryAddress);
  console.log("AnkaraFactoryRegistry:   ", registryAddress);
  console.log("─".repeat(54));
  console.log("Test tokens deployed:", deployed.length);
  deployed.forEach((addr: string, i: number) => {
    console.log(` [${i}]`, addr);
  });
  console.log("─".repeat(54));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
