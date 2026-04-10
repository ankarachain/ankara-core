"use client";

import { useState, useEffect } from "react";
import { ethers } from "ethers";
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

/**
 * useAnkaraChain
 *
 * Primary hook for connecting to Ankara Chain in a React app.
 * Handles wallet connection and factory initialization.
 *
 * @example
 * ```tsx
 * const { factory, address, isConnected } = useAnkaraChain({
 *   network: "polygon-amoy",
 *   factoryAddress: "0x...",
 * });
 * ```
 */
export function useAnkaraChain(config: AnkaraChainConfig): UseAnkaraChainReturn {
  const [factory,     setFactory]     = useState<TokenFactory | null>(null);
  const [address,     setAddress]     = useState<string | null>(null);
  const [balance,     setBalance]     = useState<string | null>(null);
  const [isLoading,   setIsLoading]   = useState(true);
  const [error,       setError]       = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        setIsLoading(true);
        setError(null);

        if (config.signer) {
          const f   = new TokenFactory(config);
          const addr = await config.signer.getAddress();
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
  }, [config.network, config.factoryAddress]);

  return {
    factory,
    address,
    balance,
    isConnected: !!address,
    isLoading,
    error,
  };
}
