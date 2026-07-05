"use client";

import { useState, useEffect } from "react";
import { TokenFactory } from "../core/TokenFactory";
import type { AnkaraChainConfig } from "../types";

interface UseAnkaraChainReturn {
  factory: TokenFactory | null;
  address: string | null;
  balance: string | null;
  isConnected: boolean;
  isLoading: boolean;
  error: Error | null;
}

/** True when `config` carries enough key material to sign — an EVM `signer`, a Stellar `stellarSecretKey`, or a Stellar `stellarSigner` (e.g. Freighter). */
function hasCredentials(config: AnkaraChainConfig): boolean {
  return (
    ("signer" in config && !!config.signer) ||
    ("stellarSecretKey" in config && !!config.stellarSecretKey) ||
    ("stellarSigner" in config && !!config.stellarSigner)
  );
}

/**
 * useAnkaraChain
 *
 * Primary hook for connecting to Ankara Chain in a React app. Handles
 * wallet connection and factory initialization on either chain — pass an
 * EVM config (`signer`) or a Stellar config (`stellarSecretKey`).
 *
 * @example
 * ```tsx
 * const { factory, address, isConnected } = useAnkaraChain({
 *   network: "polygon-amoy",
 *   factoryAddress: "0x...",
 *   signer,
 * });
 * ```
 */
export function useAnkaraChain(config: AnkaraChainConfig): UseAnkaraChainReturn {
  const [factory,     setFactory]     = useState<TokenFactory | null>(null);
  const [address,     setAddress]     = useState<string | null>(null);
  const [balance,     setBalance]     = useState<string | null>(null);
  const [isLoading,   setIsLoading]   = useState(true);
  const [error,       setError]       = useState<Error | null>(null);

  // Credential fields, narrowed out of the union so they can sit in the effect's
  // dependency array below — without these, connecting (or switching) a wallet
  // after this hook's first render would never be noticed, since `config.network`
  // and `config.factoryAddress` don't change when only the signer does.
  const evmSigner        = "signer" in config ? config.signer : undefined;
  const stellarSecretKey = "stellarSecretKey" in config ? config.stellarSecretKey : undefined;
  const stellarSigner    = "stellarSigner" in config ? config.stellarSigner : undefined;

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        setIsLoading(true);
        setError(null);

        if (hasCredentials(config)) {
          const f    = new TokenFactory(config);
          const addr = await f.adapter.getSignerAddress();
          const bal  = await f.getBalance(addr);

          if (!cancelled) {
            setFactory(f);
            setAddress(addr);
            setBalance(bal);
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    init();
    return () => { cancelled = true; };
  }, [config.network, config.factoryAddress, evmSigner, stellarSecretKey, stellarSigner]);

  return {
    factory,
    address,
    balance,
    isConnected: !!address,
    isLoading,
    error,
  };
}
