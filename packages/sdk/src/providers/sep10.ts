import { TransactionBuilder } from "@stellar/stellar-sdk";
import type { StellarExternalSigner } from "../types";

export interface Sep10Token {
  token: string;
  /** unix seconds */
  expiresAt: number;
}

/**
 * SEP-10 web authentication: fetch the anchor's challenge transaction, have
 * the wallet sign it, and exchange it for a JWT. Shared by every
 * anchor-facing provider (`StellarAnchorProvider` for SEP-24,
 * `StellarDirectPaymentProvider` for SEP-31).
 */
export async function authenticateSep10(opts: {
  webAuthEndpoint: string;
  homeDomain: string;
  signer: StellarExternalSigner;
  networkPassphrase: string;
}): Promise<Sep10Token> {
  const { webAuthEndpoint, homeDomain, signer } = opts;
  const now = Math.floor(Date.now() / 1000);

  const challengeUrl = new URL(webAuthEndpoint);
  challengeUrl.searchParams.set("account", signer.publicKey);
  challengeUrl.searchParams.set("home_domain", homeDomain);
  const challengeRes = await fetch(challengeUrl.toString());
  if (!challengeRes.ok) {
    throw new Error(`SEP-10 challenge request to ${homeDomain} failed: ${challengeRes.status} ${await challengeRes.text()}`);
  }
  const { transaction: challengeXdr, network_passphrase } = (await challengeRes.json()) as {
    transaction: string;
    network_passphrase?: string;
  };
  const passphrase = network_passphrase ?? opts.networkPassphrase;

  // Parse-then-reserialize round-trip validates the XDR is well-formed
  // before handing it to the wallet to sign.
  TransactionBuilder.fromXDR(challengeXdr, passphrase);
  const { signedTxXdr, error } = await signer.signTransaction(challengeXdr, {
    networkPassphrase: passphrase,
  });
  if (error) {
    throw new Error(`Wallet failed to sign the SEP-10 challenge for ${homeDomain}: ${JSON.stringify(error)}`);
  }

  const tokenRes = await fetch(webAuthEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transaction: signedTxXdr }),
  });
  if (!tokenRes.ok) {
    throw new Error(`SEP-10 token exchange with ${homeDomain} failed: ${tokenRes.status} ${await tokenRes.text()}`);
  }
  const { token } = (await tokenRes.json()) as { token: string };
  return { token, expiresAt: decodeJwtExpiry(token) ?? now + 300 };
}

/** Decodes a JWT's `exp` claim without verifying the signature — this token was just issued by the anchor over TLS, not received from an untrusted source. Returns undefined if unparseable. */
export function decodeJwtExpiry(jwt: string): number | undefined {
  try {
    const payload = jwt.split(".")[1];
    const json = Buffer.from(payload, "base64url").toString("utf8");
    const { exp } = JSON.parse(json) as { exp?: number };
    return exp;
  } catch {
    return undefined;
  }
}
