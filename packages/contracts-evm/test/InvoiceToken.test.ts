import { expect } from "chai";
import { ethers } from "hardhat";
import { InvoiceToken, TokenFactory } from "../typechain-types";

describe("InvoiceToken", function () {
  let factory: TokenFactory;
  let impl: InvoiceToken;
  let owner: any, investor: any, stranger: any;

  const assetId = ethers.keccak256(ethers.toUtf8Bytes("INV-NG-2024-001"));
  const now = () => BigInt(Math.floor(Date.now() / 1000));
  const days = (n: number) => BigInt(n * 24 * 60 * 60);

  const baseMeta = () => ({
    invoiceNumber: "INV-2024-00421",
    debtorReference: "DANGOTE-GROUP-001",
    faceValueUSD: ethers.parseEther("100000"),
    discountRateBps: 500n,
    issuanceDate: now(),
    dueDate: now() + days(90),
    invoiceDocumentHash: ethers.ZeroHash,
    currency: "USD",
    lastUpdated: now(),
  });

  beforeEach(async () => {
    [owner, investor, stranger] = await ethers.getSigners();
    const IT = await ethers.getContractFactory("InvoiceToken");
    impl = await IT.deploy();
    const TF = await ethers.getContractFactory("TokenFactory");
    factory = await TF.deploy(owner.address, owner.address);
    await factory.registerTemplate(3, await impl.getAddress());
  });

  async function deployToken(): Promise<InvoiceToken> {
    const tx = await factory.deployInvoiceToken(
      "Dangote Invoice 421", "DI421", assetId, "NG",
      owner.address, ethers.ZeroAddress, baseMeta()
    );
    await tx.wait();
    const tokens = await factory.getDeployerTokens(owner.address);
    return ethers.getContractAt("InvoiceToken", tokens[tokens.length - 1]);
  }

  describe("Deployment", () => {
    it("deploys with correct name", async () => {
      const t = await deployToken();
      expect(await t.name()).to.equal("Dangote Invoice 421");
    });
    it("starts in PENDING invoice status", async () => {
      const t = await deployToken();
      expect(await t.invoiceStatus()).to.equal(0);
    });
    it("starts in DRAFT asset status", async () => {
      const t = await deployToken();
      expect(await t.status()).to.equal(0);
    });
    it("stores face value correctly", async () => {
      const t = await deployToken();
      expect(await t.faceValueUSD()).to.equal(ethers.parseEther("100000"));
    });
    it("stores invoice number correctly", async () => {
      const t = await deployToken();
      const m = await t.getMetadata();
      expect(m.invoiceNumber).to.equal("INV-2024-00421");
    });
    it("stores currency correctly", async () => {
      const t = await deployToken();
      const m = await t.getMetadata();
      expect(m.currency).to.equal("USD");
    });
    it("is not overdue on deploy", async () => {
      const t = await deployToken();
      expect(await t.isOverdue()).to.be.false;
    });
    it("daysUntilDue is positive on deploy", async () => {
      const t = await deployToken();
      expect(await t.daysUntilDue()).to.be.greaterThan(0n);
    });
  });

  describe("Invoice Lifecycle", () => {
    it("manager can mark funded", async () => {
      const t = await deployToken();
      await t.markFunded();
      expect(await t.invoiceStatus()).to.equal(1);
    });
    it("asset status becomes ACTIVE when funded", async () => {
      const t = await deployToken();
      await t.markFunded();
      expect(await t.status()).to.equal(1);
    });
    it("manager can mark repaid", async () => {
      const t = await deployToken();
      await t.markFunded();
      await t.markRepaid();
      expect(await t.invoiceStatus()).to.equal(2);
    });
    it("asset status becomes REDEEMED when repaid", async () => {
      const t = await deployToken();
      await t.markFunded();
      await t.markRepaid();
      expect(await t.status()).to.equal(3);
    });
    it("manager can mark defaulted", async () => {
      const t = await deployToken();
      await t.markFunded();
      await t.markDefaulted("Debtor insolvent");
      expect(await t.invoiceStatus()).to.equal(3);
    });
    it("asset status becomes SUSPENDED when defaulted", async () => {
      const t = await deployToken();
      await t.markFunded();
      await t.markDefaulted("Payment overdue");
      expect(await t.status()).to.equal(2);
    });
    it("cannot mark repaid if already defaulted", async () => {
      const t = await deployToken();
      await t.markFunded();
      await t.markDefaulted("Insolvent");
      await expect(t.markRepaid()).to.be.revertedWithCustomError(t, "InvoiceAlreadySettled");
    });
    it("cannot mark defaulted if already repaid", async () => {
      const t = await deployToken();
      await t.markFunded();
      await t.markRepaid();
      await expect(t.markDefaulted("Too late")).to.be.revertedWithCustomError(t, "InvoiceAlreadySettled");
    });
    it("stranger cannot mark funded", async () => {
      const t = await deployToken();
      await expect(t.connect(stranger).markFunded()).to.be.reverted;
    });
    it("emits InvoiceStatusChanged on markFunded", async () => {
      const t = await deployToken();
      await expect(t.markFunded()).to.emit(t, "InvoiceStatusChanged");
    });
    it("emits InvoiceRepaid on markRepaid", async () => {
      const t = await deployToken();
      await t.markFunded();
      await expect(t.markRepaid()).to.emit(t, "InvoiceRepaid");
    });
    it("emits InvoiceDefaulted on markDefaulted", async () => {
      const t = await deployToken();
      await t.markFunded();
      await expect(t.markDefaulted("Non-payment")).to.emit(t, "InvoiceDefaulted");
    });
  });

  describe("Metadata", () => {
    it("manager can update metadata when pending", async () => {
      const t = await deployToken();
      await expect(t.updateMetadata(baseMeta())).to.not.be.reverted;
    });
    it("cannot update metadata after repayment", async () => {
      const t = await deployToken();
      await t.markFunded();
      await t.markRepaid();
      await expect(t.updateMetadata(baseMeta()))
        .to.be.revertedWithCustomError(t, "InvoiceAlreadySettled");
    });
    it("increments version on metadata update", async () => {
      const t = await deployToken();
      await t.updateMetadata(baseMeta());
      expect(await t.metadataVersion()).to.equal(2n);
    });
    it("stranger cannot update metadata", async () => {
      const t = await deployToken();
      await expect(t.connect(stranger).updateMetadata(baseMeta())).to.be.reverted;
    });
  });

  describe("Minting", () => {
    it("owner can mint investor shares", async () => {
      const t = await deployToken();
      await t.mint(investor.address, ethers.parseEther("1000"));
      expect(await t.balanceOf(investor.address)).to.equal(ethers.parseEther("1000"));
    });
    it("stranger cannot mint", async () => {
      const t = await deployToken();
      await expect(t.connect(stranger).mint(investor.address, 100n)).to.be.reverted;
    });
  });
});
