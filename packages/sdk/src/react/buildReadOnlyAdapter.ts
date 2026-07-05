import { ethers } from "ethers";
import { getNetwork } from "../utils/networks";
import { EVMAdapter } from "../adapters/evm";
import { StellarAdapter } from "../adapters/stellar";
import type { IAdapter } from "../adapters/IAdapter";
import type { SupportedNetwork, EVMSupportedNetwork, StellarSupportedNetwork } from "../types";

/**
 * Builds a signerless, read-only `IAdapter` for either chain — shared by
 * `useAsset` and `useTokenBalance`, neither of which need write access.
 */
export function buildReadOnlyAdapter(network: SupportedNetwork, rpcUrl?: string): IAdapter {
  const networkConfig = getNetwork(network);
  if (networkConfig.chainFamily === "stellar") {
    const stellarNetwork = network as StellarSupportedNetwork;
    return new StellarAdapter(stellarNetwork, { network: stellarNetwork, rpcUrl });
  }
  const provider = new ethers.JsonRpcProvider(rpcUrl ?? networkConfig.rpcUrl, networkConfig.chainId);
  return new EVMAdapter(network as EVMSupportedNetwork, provider);
}
