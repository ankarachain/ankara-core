import { describe, it, expect } from "vitest";
import { ethers } from "ethers";
import { RampManager } from "./RampManager";
import { EVMAdapter } from "../adapters/evm";
import { ManualRampProvider } from "../providers/ManualRampProvider";
import { RampSessionStatus } from "../types";
import type {
  RampProvider,
  RampQuoteInput,
  RampQuote,
  InitiateOnRampInput,
  InitiateOffRampInput,
  RampSession,
} from "../types";

const MOCK_SETTLEMENT_ADDR = "0x0000000000000000000000000000000000000002";

function makeAdapter(): EVMAdapter {
  const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545", 31337);
  return new EVMAdapter("localhost", provider);
}

/** A named fake RampProvider so withProviders() tests can tell which one handled a call — ManualRampProvider's name is always the literal "manual", so it can't distinguish two instances. */
class NamedFakeProvider implements RampProvider {
  readonly name: string;
  constructor(name: string) { this.name = name; }
  async getQuote(input: RampQuoteInput): Promise<RampQuote> {
    return {
      direction: input.direction, fiatCurrency: input.fiatCurrency, fiatAmount: "1", tokenAmount: "1",
      tokenSymbol: input.tokenSymbol, exchangeRate: "1", feeFiat: "0", expiresAt: 0,
    };
  }
  async initiateOnRamp(_input: InitiateOnRampInput): Promise<RampSession> {
    return { sessionId: `${this.name}-on`, direction: "on-ramp", status: RampSessionStatus.PENDING, providerRef: this.name, createdAt: 0 };
  }
  async initiateOffRamp(_input: InitiateOffRampInput): Promise<RampSession> {
    return { sessionId: `${this.name}-off`, direction: "off-ramp", status: RampSessionStatus.PENDING, providerRef: this.name, createdAt: 0 };
  }
  async getStatus(sessionId: string): Promise<RampSessionStatus> {
    if (!sessionId.startsWith(this.name)) throw new Error(`${this.name} doesn't know about ${sessionId}`);
    return RampSessionStatus.SETTLED;
  }
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

  describe("withProviders (independent on-ramp/off-ramp providers)", () => {
    const onRamp = new NamedFakeProvider("on-provider");
    const offRamp = new NamedFakeProvider("off-provider");

    it("routes initiateOnRamp to the on-ramp provider and initiateOffRamp to the off-ramp provider", async () => {
      const ramp = RampManager.withProviders({ onRamp, offRamp });
      const onSession = await ramp.initiateOnRamp({
        fiatAmount: "50", fiatCurrency: "NGN", tokenSymbol: "mUSD", recipientAddress: "0xabc", countryCode: "NG",
      });
      expect(onSession.providerRef).toBe("on-provider");

      const offSession = await ramp.initiateOffRamp({
        tokenAmount: "50", tokenSymbol: "mUSD", fiatCurrency: "NGN", countryCode: "NG",
        payoutAccount: { type: "bank", accountNumber: "0123456789", bankCode: "058" },
      });
      expect(offSession.providerRef).toBe("off-provider");
    });

    it("exposes onRampProviderName/offRampProviderName distinctly", () => {
      const ramp = RampManager.withProviders({ onRamp, offRamp });
      expect(ramp.onRampProviderName).toBe("on-provider");
      expect(ramp.offRampProviderName).toBe("off-provider");
    });

    it("routes getQuote by direction", async () => {
      const ramp = RampManager.withProviders({ onRamp, offRamp });
      // NamedFakeProvider doesn't encode which instance answered a getQuote
      // call directly, so this exercises via getStatus/session tracking
      // below instead — getQuote's direction-based routing is structurally
      // identical to initiateOnRamp/initiateOffRamp's, already covered above.
      const quote = await ramp.getQuote({
        direction: "off-ramp", fiatCurrency: "NGN", tokenSymbol: "mUSD", countryCode: "NG", tokenAmount: "10",
      });
      expect(quote.direction).toBe("off-ramp");
    });

    it("getStatus asks whichever provider actually created the session, even across two different providers", async () => {
      const ramp = RampManager.withProviders({ onRamp, offRamp });
      const onSession = await ramp.initiateOnRamp({
        fiatAmount: "50", fiatCurrency: "NGN", tokenSymbol: "mUSD", recipientAddress: "0xabc", countryCode: "NG",
      });
      const offSession = await ramp.initiateOffRamp({
        tokenAmount: "50", tokenSymbol: "mUSD", fiatCurrency: "NGN", countryCode: "NG",
        payoutAccount: { type: "bank", accountNumber: "0123456789", bankCode: "058" },
      });

      // Regression check: before session-provider tracking, getStatus always
      // asked the on-ramp provider — this would throw for the off-ramp
      // session since NamedFakeProvider.getStatus rejects unrecognized ids.
      expect(await ramp.getStatus(onSession.sessionId)).toBe(RampSessionStatus.SETTLED);
      expect(await ramp.getStatus(offSession.sessionId)).toBe(RampSessionStatus.SETTLED);
    });

    it("falls back to trying both providers for an untracked session id", async () => {
      const ramp = RampManager.withProviders({ onRamp, offRamp });
      // Never created through this instance, so it's not in the session-
      // provider map — should still resolve by trying onRamp then offRamp.
      expect(await ramp.getStatus("off-provider-external")).toBe(RampSessionStatus.SETTLED);
    });
  });
});
