import { describe, it, expect } from "vitest";
import { ethers } from "ethers";
import { RampManager } from "./RampManager";
import { EVMAdapter } from "../adapters/evm";
import { ManualRampProvider } from "../providers/ManualRampProvider";

const MOCK_SETTLEMENT_ADDR = "0x0000000000000000000000000000000000000002";

function makeAdapter(): EVMAdapter {
  const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545", 31337);
  return new EVMAdapter("localhost", provider);
}

describe("RampManager", () => {
  describe("without a settlement contract", () => {
    it("instantiates with just a provider", () => {
      expect(() => new RampManager(new ManualRampProvider())).not.toThrow();
    });

    it("hasSettlementContract is false", () => {
      const ramp = new RampManager(new ManualRampProvider());
      expect(ramp.hasSettlementContract).toBe(false);
      expect(ramp.settlementAddress).toBeUndefined();
    });

    it("exposes providerName from the underlying provider", () => {
      const ramp = new RampManager(new ManualRampProvider());
      expect(ramp.providerName).toBe("manual");
    });

    it("delegates getQuote to the provider", async () => {
      const ramp = new RampManager(new ManualRampProvider({ exchangeRates: { NGN: 1 }, feeBps: 0 }));
      const quote = await ramp.getQuote({
        direction: "on-ramp", fiatCurrency: "NGN", tokenSymbol: "mUSD", countryCode: "NG", fiatAmount: "100",
      });
      expect(quote.fiatAmount).toBe("100.00");
    });

    it("delegates initiateOnRamp/initiateOffRamp/getStatus to the provider", async () => {
      const ramp = new RampManager(new ManualRampProvider());
      const onRampSession = await ramp.initiateOnRamp({
        fiatAmount: "50", fiatCurrency: "NGN", tokenSymbol: "mUSD",
        recipientAddress: "0xabc", countryCode: "NG",
      });
      expect(onRampSession.direction).toBe("on-ramp");

      const offRampSession = await ramp.initiateOffRamp({
        tokenAmount: "50", tokenSymbol: "mUSD", fiatCurrency: "NGN",
        countryCode: "NG", payoutAccount: { type: "bank", accountNumber: "0123456789", bankCode: "058" },
      });
      expect(offRampSession.direction).toBe("off-ramp");

      expect(await ramp.getStatus(onRampSession.sessionId)).toBe("pending");
    });

    it("on-chain methods throw a clear configuration error", async () => {
      const ramp = new RampManager(new ManualRampProvider());
      await expect(ramp.depositOffRamp("s1", "0xtoken", 1n))
        .rejects.toThrow(/settlement contract/i);
      await expect(ramp.confirmOffRampSettlement("s1"))
        .rejects.toThrow(/settlement contract/i);
      await expect(ramp.refundOffRamp("s1"))
        .rejects.toThrow(/settlement contract/i);
      await expect(ramp.recordOnRampSettlement("s1", "0xrecipient", "0xtoken", 1n))
        .rejects.toThrow(/settlement contract/i);
      await expect(ramp.getOffRampDeposit("s1"))
        .rejects.toThrow(/settlement contract/i);
      await expect(ramp.getOnRampRecord("s1"))
        .rejects.toThrow(/settlement contract/i);
    });
  });

  describe("with a settlement contract configured", () => {
    it("hasSettlementContract is true and exposes the address", () => {
      const ramp = new RampManager(new ManualRampProvider(), makeAdapter(), {
        settlementAddress: MOCK_SETTLEMENT_ADDR,
      });
      expect(ramp.hasSettlementContract).toBe(true);
      expect(ramp.settlementAddress).toBe(MOCK_SETTLEMENT_ADDR);
    });

    it("on-chain methods exist as callable functions", () => {
      const ramp = new RampManager(new ManualRampProvider(), makeAdapter(), {
        settlementAddress: MOCK_SETTLEMENT_ADDR,
      });
      const methods = [
        "depositOffRamp", "confirmOffRampSettlement", "refundOffRamp",
        "recordOnRampSettlement", "getOffRampDeposit", "getOnRampRecord",
      ];
      for (const m of methods) {
        expect(typeof (ramp as any)[m], m).toBe("function");
      }
    });
  });
});
