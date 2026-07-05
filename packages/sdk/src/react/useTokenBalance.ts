"use client";

import { useState, useEffect } from "react";
import { ethers } from "ethers";
import { buildReadOnlyAdapter } from "./buildReadOnlyAdapter";
import type { SupportedNetwork } from "../types";

interface UseTokenBalanceReturn {
  balance: bigint | null;
  formatted: string | null;
  isLoading: boolean;
  error: Error | null;
  refresh: () => void;
}

/**
 * useTokenBalance
 *
 * Hook for reading a fungible token balance in React — works against any
 * deployed template on either chain (EVM ERC-20 or Stellar SEP-41), read-only,
 * no signer/secret key required.
 *
 * @example
 * ```tsx
 * const { balance, formatted } = useTokenBalance({
 *   tokenAddress: "0x...",
 *   walletAddress: "0x...",
 *   network: "polygon-amoy",
 * });
 * ```
 */
export function useTokenBalance(opts: {
  tokenAddress: string;
  walletAddress: string;
  network: SupportedNetwork;
  rpcUrl?: string;
}): UseTokenBalanceReturn {
  const [balance,   setBalance]   = useState<bigint | null>(null);
  const [formatted, setFormatted] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error,     setError]     = useState<Error | null>(null);
  const [tick,      setTick]      = useState(0);

  const refresh = () => setTick(t => t + 1);

  useEffect(() => {
    if (!opts.tokenAddress || !opts.walletAddress) return;

    let cancelled = false;

    async function load() {
      try {
        setIsLoading(true);
        const adapter = buildReadOnlyAdapter(opts.network, opts.rpcUrl);
        const bal     = await adapter.getBalance2(opts.tokenAddress, opts.walletAddress);

        if (!cancelled) {
          setBalance(bal);
          setFormatted(ethers.formatEther(bal));
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [opts.tokenAddress, opts.walletAddress, opts.network, tick]);

  return { balance, formatted, isLoading, error, refresh };
}
