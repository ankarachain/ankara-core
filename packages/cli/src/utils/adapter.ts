import { ethers } from "ethers";
import { NETWORKS, EVMAdapter, StellarAdapter } from "@ankarachain/sdk";
import type { AnkaraChainConfig, EVMAnkaraChainConfig, StellarAnkaraChainConfig, EVMSupportedNetwork, IAdapter } from "@ankarachain/sdk";
import { getPrivateKey, getStellarSecretKey, getRpcUrl, isStellarNetwork } from "./config.js";
import type { AnkaraChainProjectConfig } from "./config.js";

/**
 * Builds the `AnkaraChainConfig` for `TokenFactory`, resolving the right key
 * material for whichever chain family `ankara.config.json` targets
 * (`PRIVATE_KEY` for EVM, `STELLAR_SECRET_KEY` for Stellar) — every deploy
 * command that wants to work on both chains should build its `TokenFactory`
 * from this instead of constructing an `ethers.Wallet`/provider directly.
 *
 * Pass `{ readOnly: true }` for commands that only read chain state (e.g.
 * `status`) — this skips resolving `PRIVATE_KEY`/`STELLAR_SECRET_KEY`
 * entirely, so read-only commands keep working with no signing key
 * configured at all, same as before adapters were unified.
 */
export function buildAnkaraChainConfig(
  config: AnkaraChainProjectConfig,
  opts: { readOnly?: boolean } = {}
): AnkaraChainConfig {
  const rpcUrl = getRpcUrl(config);

  if (isStellarNetwork(config.network)) {
    return {
      network: config.network as "stellar" | "stellar-testnet",
      stellarSecretKey: opts.readOnly ? undefined : getStellarSecretKey(),
      factoryAddress: config.factoryAddress,
      nftFactoryAddress: config.nftFactoryAddress,
      multiTokenFactoryAddress: config.multiTokenFactoryAddress,
      escrowFactoryAddress: config.escrowFactoryAddress,
      rampSettlementFactoryAddress: config.rampSettlementFactoryAddress,
      rpcUrl: rpcUrl || undefined,
    };
  }

  const evmNetwork = config.network as EVMSupportedNetwork;
  const networkInfo = NETWORKS[evmNetwork];
  if (networkInfo.chainFamily !== "evm") {
    throw new Error(`Network ${config.network} is not configured as an EVM network.`);
  }
  const provider = new ethers.JsonRpcProvider(rpcUrl || networkInfo.rpcUrl, networkInfo.chainId);
  const signer = opts.readOnly ? undefined : new ethers.Wallet(getPrivateKey(), provider);

  return {
    network: evmNetwork,
    signer,
    provider,
    factoryAddress: config.factoryAddress,
    nftFactoryAddress: config.nftFactoryAddress,
    multiTokenFactoryAddress: config.multiTokenFactoryAddress,
    escrowFactoryAddress: config.escrowFactoryAddress,
    rampSettlementFactoryAddress: config.rampSettlementFactoryAddress,
    rpcUrl: rpcUrl || undefined,
  };
}

/**
 * Builds a ready-to-use `IAdapter` (an `EVMAdapter` or a `StellarAdapter`,
 * whichever `ankara.config.json` targets) for commands that hand it to
 * `EscrowManager`, `RampManager`, or `AssetRegistry` — those classes work
 * against either chain identically, so the command itself never needs to
 * branch on network family beyond calling this.
 *
 * Pass `{ readOnly: true }` for commands that never submit a transaction —
 * see `buildAnkaraChainConfig`.
 */
export function buildAdapter(config: AnkaraChainProjectConfig, opts: { readOnly?: boolean } = {}): IAdapter {
  const chainConfig = buildAnkaraChainConfig(config, opts);
  if (isStellarNetwork(chainConfig.network)) {
    const stellarConfig = chainConfig as StellarAnkaraChainConfig;
    return new StellarAdapter(stellarConfig.network, stellarConfig);
  }

  const evmConfig = chainConfig as EVMAnkaraChainConfig;
  const networkInfo = NETWORKS[evmConfig.network];
  if (networkInfo.chainFamily !== "evm") {
    throw new Error(`Network ${evmConfig.network} is not configured as an EVM network.`);
  }
  const provider = evmConfig.provider ?? new ethers.JsonRpcProvider(
    evmConfig.rpcUrl || networkInfo.rpcUrl, networkInfo.chainId
  );
  return new EVMAdapter(
    evmConfig.network,
    provider,
    evmConfig.signer,
    evmConfig.factoryAddress,
    evmConfig.nftFactoryAddress,
    evmConfig.escrowFactoryAddress,
    evmConfig.multiTokenFactoryAddress,
    evmConfig.rampSettlementFactoryAddress
  );
}
