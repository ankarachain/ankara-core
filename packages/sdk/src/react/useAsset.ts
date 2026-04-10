"use client";

import { useState, useEffect } from "react";
import { AssetRegistry } from "../core/AssetRegistry";
import { EVMAdapter } from "../adapters/evm";
import { ethers } from "ethers";
import { getNetwork } from "../utils/networks";
import type { SupportedNetwork, AssetStatus } from "../types";

interface AssetState {
  name: string | null;
  symbol: string | null;
  status: AssetStatus | null;
  countryCode: string | null;
  valuationUSD: bigint | null;
  version: number | null;
  metadata: any | null;
}

interface UseAssetReturn extends AssetState {
  registry: AssetRegistry | null;
  isLoading: boolean;
  error: Error | null;
  refresh: () => void;
}

/**
 * useAsset
 *
 * Hook for reading Ankara Chain token data in React.
 *
 * @example
 * ```tsx
 * const { name, status, valuationUSD, isLoading } = useAsset({
 *   tokenAddress: "0x...",
 *   template: "farmland",
 *   network: "polygon-amoy",
 *   rpcUrl: "https://...",
 * });
 * ```
 */
export function useAsset(opts: {
  tokenAddress: string;
  template: "farmland" | "commodity";
  network: SupportedNetwork;
  rpcUrl?: string;
}): UseAssetReturn {
  const [state,     setState]     = useState<AssetState>({
    name: null, symbol: null, status: null,
    countryCode: null, valuationUSD: null, version: null, metadata: null,
  });
  const [registry,  setRegistry]  = useState<AssetRegistry | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error,     setError]     = useState<Error | null>(null);
  const [tick,      setTick]      = useState(0);

  const refresh = () => setTick(t => t + 1);

  useEffect(() => {
    if (!opts.tokenAddress || opts.tokenAddress === ethers.ZeroAddress) return;

    let cancelled = false;

    async function load() {
      try {
        setIsLoading(true);
        setError(null);

        const networkConfig = getNetwork(opts.network);
        const provider = new ethers.JsonRpcProvider(
          opts.rpcUrl ?? networkConfig.rpcUrl,
          networkConfig.chainId
        );

        const adapter  = new EVMAdapter(opts.network, provider);
        const reg      = new AssetRegistry(adapter, opts.tokenAddress, opts.template);

        const [name, symbol, status, countryCode, valuationUSD, version, metadata] =
          await Promise.all([
            reg.getName(),
            reg.getSymbol(),
            reg.getStatus(),
            reg.getCountryCode(),
            reg.getValuationUSD(),
            reg.getVersion(),
            reg.getMetadata(),
          ]);

        if (!cancelled) {
          setRegistry(reg);
          setState({ name, symbol, status, countryCode, valuationUSD, version, metadata });
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [opts.tokenAddress, opts.network, tick]);

  return { ...state, registry, isLoading, error, refresh };
}
