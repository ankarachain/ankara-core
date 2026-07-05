"use client";

import { useState, useEffect } from "react";
import { AssetRegistry } from "../core/AssetRegistry";
import type { AnyAssetMetadata } from "../adapters/IAdapter";
import { buildReadOnlyAdapter } from "./buildReadOnlyAdapter";
import type { AssetTemplate, AssetStatus, SupportedNetwork } from "../types";

interface AssetState {
  name: string | null;
  symbol: string | null;
  status: AssetStatus | null;
  countryCode: string | null;
  valuationUSD: bigint | null;
  version: number | null;
  metadata: AnyAssetMetadata | null;
}

interface UseAssetReturn extends AssetState {
  registry: AssetRegistry | null;
  isLoading: boolean;
  error: Error | null;
  refresh: () => void;
}

const ZERO_ADDRESSES = new Set(["", "0x0000000000000000000000000000000000000000"]);

/** Only these 3 templates expose a valuation — invoice/carbon-credit/mining-rights don't. */
const TEMPLATES_WITH_VALUATION = new Set<AssetTemplate>(["farmland", "commodity", "real-estate"]);

/**
 * useAsset
 *
 * Hook for reading Ankara Chain token data in React — works against any of
 * the 6 fungible templates on either chain (EVM or Stellar), read-only, no
 * signer/secret key required.
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
  template: AssetTemplate;
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
    if (!opts.tokenAddress || ZERO_ADDRESSES.has(opts.tokenAddress)) return;

    let cancelled = false;

    async function load() {
      try {
        setIsLoading(true);
        setError(null);

        const adapter = buildReadOnlyAdapter(opts.network, opts.rpcUrl);
        const reg     = new AssetRegistry(adapter, opts.tokenAddress, opts.template);

        const [name, symbol, status, countryCode, valuationUSD, version, metadata] =
          await Promise.all([
            reg.getName(),
            reg.getSymbol(),
            reg.getStatus(),
            reg.getCountryCode(),
            TEMPLATES_WITH_VALUATION.has(opts.template) ? reg.getValuationUSD() : Promise.resolve(null),
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
  }, [opts.tokenAddress, opts.network, opts.template, tick]);

  return { ...state, registry, isLoading, error, refresh };
}
