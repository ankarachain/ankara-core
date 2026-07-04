import { describe, it, expect } from "vitest";
import { ManualRampProvider } from "./ManualRampProvider";
import { RampSessionStatus } from "../types";

describe("ManualRampProvider", () => {
  describe("getQuote", () => {
    it("computes tokenAmount from fiatAmount using the configured rate", async () => {
      const provider = new ManualRampProvider({ exchangeRates: { NGN: 1 / 1500 }, feeBps: 0 });
      const quote = await provider.getQuote({
        direction: "on-ramp", fiatCurrency: "NGN", tokenSymbol: "mUSD",
        countryCode: "NG", fiatAmount: "1500",
      });
      expect(parseFloat(quote.tokenAmount)).toBeCloseTo(1, 5);
      expect(quote.fiatAmount).toBe("1500.00");
    });

    it("computes fiatAmount from tokenAmount using the configured rate", async () => {
      const provider = new ManualRampProvider({ exchangeRates: { NGN: 1 / 1500 }, feeBps: 0 });
      const quote = await provider.getQuote({
        direction: "off-ramp", fiatCurrency: "NGN", tokenSymbol: "mUSD",
        countryCode: "NG", tokenAmount: "1",
      });
      expect(quote.fiatAmount).toBe("1500.00");
    });

    it("applies the configured fee in bps to the fiat amount", async () => {
      const provider = new ManualRampProvider({ exchangeRates: { NGN: 1 }, feeBps: 100 });
      const quote = await provider.getQuote({
        direction: "on-ramp", fiatCurrency: "NGN", tokenSymbol: "mUSD",
        countryCode: "NG", fiatAmount: "1000",
      });
      expect(quote.feeFiat).toBe("10.00"); // 1% of 1000
    });

    it("throws when neither fiatAmount nor tokenAmount is provided", async () => {
      const provider = new ManualRampProvider();
      await expect(provider.getQuote({
        direction: "on-ramp", fiatCurrency: "NGN", tokenSymbol: "mUSD", countryCode: "NG",
      })).rejects.toThrow();
    });

    it("falls back to a 1:1 rate for an unconfigured currency", async () => {
      const provider = new ManualRampProvider({ feeBps: 0 });
      const quote = await provider.getQuote({
        direction: "on-ramp", fiatCurrency: "ZZZ", tokenSymbol: "mUSD",
        countryCode: "NG", fiatAmount: "50",
      });
      expect(quote.tokenAmount).toBe("50.000000");
    });

    it("uses default African exchange rates when none are configured", async () => {
      const provider = new ManualRampProvider();
      const quote = await provider.getQuote({
        direction: "on-ramp", fiatCurrency: "KES", tokenSymbol: "mUSD",
        countryCode: "KE", fiatAmount: "150",
      });
      expect(parseFloat(quote.tokenAmount)).toBeGreaterThan(0);
    });

    it("sets an expiresAt timestamp in the future", async () => {
      const provider = new ManualRampProvider();
      const before = Math.floor(Date.now() / 1000);
      const quote = await provider.getQuote({
        direction: "on-ramp", fiatCurrency: "NGN", tokenSymbol: "mUSD",
        countryCode: "NG", fiatAmount: "100",
      });
      expect(quote.expiresAt).toBeGreaterThan(before);
    });
  });

  describe("initiateOnRamp / initiateOffRamp", () => {
    it("creates a PENDING on-ramp session with a paymentUrl", async () => {
      const provider = new ManualRampProvider();
      const session = await provider.initiateOnRamp({
        fiatAmount: "100", fiatCurrency: "NGN", tokenSymbol: "mUSD",
        recipientAddress: "0xabc", countryCode: "NG",
      });
      expect(session.direction).toBe("on-ramp");
      expect(session.status).toBe(RampSessionStatus.PENDING);
      expect(session.paymentUrl).toBeDefined();
    });

    it("creates a PENDING off-ramp session without a paymentUrl", async () => {
      const provider = new ManualRampProvider();
      const session = await provider.initiateOffRamp({
        tokenAmount: "100", tokenSymbol: "mUSD", fiatCurrency: "NGN",
        countryCode: "NG", payoutAccount: { type: "bank", accountNumber: "0123456789", bankCode: "058" },
      });
      expect(session.direction).toBe("off-ramp");
      expect(session.status).toBe(RampSessionStatus.PENDING);
      expect(session.paymentUrl).toBeUndefined();
    });

    it("generates unique session IDs across calls", async () => {
      const provider = new ManualRampProvider();
      const s1 = await provider.initiateOnRamp({
        fiatAmount: "1", fiatCurrency: "NGN", tokenSymbol: "mUSD", recipientAddress: "0xabc", countryCode: "NG",
      });
      const s2 = await provider.initiateOnRamp({
        fiatAmount: "1", fiatCurrency: "NGN", tokenSymbol: "mUSD", recipientAddress: "0xabc", countryCode: "NG",
      });
      expect(s1.sessionId).not.toBe(s2.sessionId);
    });
  });

  describe("getStatus / markSettled / markFailed", () => {
    it("returns PENDING right after session creation", async () => {
      const provider = new ManualRampProvider();
      const session = await provider.initiateOnRamp({
        fiatAmount: "1", fiatCurrency: "NGN", tokenSymbol: "mUSD", recipientAddress: "0xabc", countryCode: "NG",
      });
      expect(await provider.getStatus(session.sessionId)).toBe(RampSessionStatus.PENDING);
    });

    it("markSettled flips status to SETTLED", async () => {
      const provider = new ManualRampProvider();
      const session = await provider.initiateOnRamp({
        fiatAmount: "1", fiatCurrency: "NGN", tokenSymbol: "mUSD", recipientAddress: "0xabc", countryCode: "NG",
      });
      provider.markSettled(session.sessionId);
      expect(await provider.getStatus(session.sessionId)).toBe(RampSessionStatus.SETTLED);
    });

    it("markFailed flips status to FAILED", async () => {
      const provider = new ManualRampProvider();
      const session = await provider.initiateOffRamp({
        tokenAmount: "1", tokenSymbol: "mUSD", fiatCurrency: "NGN",
        countryCode: "NG", payoutAccount: { type: "mobile-money", accountNumber: "0700000000", provider: "MTN" },
      });
      provider.markFailed(session.sessionId);
      expect(await provider.getStatus(session.sessionId)).toBe(RampSessionStatus.FAILED);
    });

    it("getStatus throws for an unknown session", async () => {
      const provider = new ManualRampProvider();
      await expect(provider.getStatus("nonexistent")).rejects.toThrow();
    });

    it("markSettled throws for an unknown session", () => {
      const provider = new ManualRampProvider();
      expect(() => provider.markSettled("nonexistent")).toThrow();
    });
  });
});
