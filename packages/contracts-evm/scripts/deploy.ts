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

  console.log("\n" + "─".repeat(54));
  console.log("✅  Ankara Chain — full suite deployed");
  console.log("─".repeat(54));
  console.log("WhitelistVerifier:       ", await verifier.getAddress());
  templates.forEach((t, i) => {
    console.log(`${t.padEnd(25)}`, impls[t]);
  });
  console.log("TokenFactory:            ", factoryAddress);
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
