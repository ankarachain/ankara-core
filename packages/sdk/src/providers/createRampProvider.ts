import type { RampProviderSelection, RampProvider, StellarExternalSigner } from "../types";
import { ManualRampProvider } from "./ManualRampProvider";
import { StellarAnchorProvider } from "./StellarAnchorProvider";
import { MoonPayProvider } from "./MoonPayProvider";

export interface CreateRampProviderDeps {
  /** Required if `selection.provider === "stellar-anchor"` — SEP-10 auth signs with the user's own wallet, there's no shared secret to configure. */
  stellarSigner?: StellarExternalSigner;
}

/**
 * Turns a declarative `RampProviderSelection` into a live `RampProvider`
 * instance — the piece that lets a developer (or a dashboard's Settings
 * UI) pick a provider by name and plug in credentials, without importing
 * and constructing provider classes directly.
 *
 * `moonpay` selections carry a secret key — only call this where that's
 * safe to hold (server-side; see MoonPayProvider's own doc comment). Never
 * call this with a `moonpay` selection inside a browser-rendered component.
 */
export function createRampProvider(selection: RampProviderSelection, deps: CreateRampProviderDeps = {}): RampProvider {
  switch (selection.provider) {
    case "manual":
      return new ManualRampProvider({ exchangeRates: selection.exchangeRates, feeBps: selection.feeBps });

    case "stellar-anchor":
      if (!deps.stellarSigner) {
        throw new Error("createRampProvider: a stellar-anchor selection requires deps.stellarSigner (SEP-10 auth signs with the user's own wallet).");
      }
      return new StellarAnchorProvider({ homeDomain: selection.homeDomain, signer: deps.stellarSigner });

    case "moonpay":
      return new MoonPayProvider({ apiKey: selection.apiKey, secretKey: selection.secretKey, sandbox: selection.sandbox });

    default: {
      const exhaustive: never = selection;
      throw new Error(`createRampProvider: unrecognized provider selection ${JSON.stringify(exhaustive)}`);
    }
  }
}
