import { ethers } from "ethers";
import {
  TokenFactory,
  EVMAdapter,
  StellarAdapter,
  NETWORKS,
} from "@ankarachain/sdk";
import type {
  AnkaraChainConfig,
  EVMSupportedNetwork,
  IAdapter,
  StellarSupportedNetwork,
  SupportedNetwork,
} from "@ankarachain/sdk";

/**
 * Every chain-touching tool accepts the same connection arguments. EVM tools
 * keep their original `rpcUrl` + `privateKey` shape (and `network` defaults
 * to `localhost`, as before); Stellar tools pass `network: "stellar" |
 * "stellar-testnet"` plus `stellarSecretKey` (and optionally `rpcUrl` to
 * override the default Soroban RPC).
 */
export const NETWORK_NAMES = Object.keys(NETWORKS) as SupportedNetwork[];

export const CONNECTION_PROPS = {
  network: {
    type: "string",
    enum: NETWORK_NAMES,
    description: "Target network (default: localhost). Use stellar / stellar-testnet for Soroban.",
  },
  rpcUrl: {
    type: "string",
    description: "RPC endpoint. EVM: JSON-RPC URL (required). Stellar: Soroban RPC URL (optional — defaults per network).",
  },
  privateKey: { type: "string", description: "EVM signer private key (0x-prefixed). Not used on Stellar." },
  stellarSecretKey: { type: "string", description: "Stellar signer secret seed (S...). Stellar networks only." },
} as const;

/** Same, for read-only tools: no key needed. */
export const READ_CONNECTION_PROPS = {
  network: CONNECTION_PROPS.network,
  rpcUrl: CONNECTION_PROPS.rpcUrl,
} as const;

export interface ConnectionArgs {
  network?: string;
  rpcUrl?: string;
  privateKey?: string;
  stellarSecretKey?: string;
}

/** Factory/registry contract addresses a tool may need. */
export interface FactoryAddresses {
  factoryAddress?: string;
  nftFactoryAddress?: string;
  multiTokenFactoryAddress?: string;
  escrowFactoryAddress?: string;
  rampSettlementFactoryAddress?: string;
}

export function networkOf(args: ConnectionArgs): SupportedNetwork {
  const network = (args.network ?? "localhost") as SupportedNetwork;
  if (!NETWORKS[network]) {
    throw new Error(`Unknown network "${args.network}". Expected one of: ${NETWORK_NAMES.join(", ")}`);
  }
  return network;
}

export function isStellar(args: ConnectionArgs): boolean {
  return NETWORKS[networkOf(args)].chainFamily === "stellar";
}

function evmProvider(args: ConnectionArgs): ethers.JsonRpcProvider {
  if (!args.rpcUrl) throw new Error("rpcUrl is required on EVM networks");
  return new ethers.JsonRpcProvider(args.rpcUrl);
}

export function evmWallet(args: ConnectionArgs): ethers.Wallet {
  if (!args.privateKey) throw new Error("privateKey is required to sign on EVM networks");
  return new ethers.Wallet(args.privateKey, evmProvider(args));
}

function stellarConfig(args: ConnectionArgs, addresses: FactoryAddresses, readOnly: boolean) {
  if (!readOnly && !args.stellarSecretKey) {
    throw new Error("stellarSecretKey is required to sign on Stellar networks");
  }
  return {
    network: networkOf(args) as StellarSupportedNetwork,
    stellarSecretKey: readOnly ? undefined : args.stellarSecretKey,
    rpcUrl: args.rpcUrl,
    ...addresses,
  };
}

/** A chain-appropriate `IAdapter` for the given connection. */
export function adapterFor(
  args: ConnectionArgs,
  addresses: FactoryAddresses = {},
  opts: { readOnly?: boolean } = {}
): IAdapter {
  const network = networkOf(args);
  if (isStellar(args)) {
    return new StellarAdapter(network as StellarSupportedNetwork, stellarConfig(args, addresses, !!opts.readOnly));
  }
  const provider = evmProvider(args);
  const signer = opts.readOnly ? undefined : evmWallet(args);
  return new EVMAdapter(
    network as EVMSupportedNetwork,
    (signer?.provider as ethers.Provider | undefined) ?? provider,
    signer,
    addresses.factoryAddress,
    addresses.nftFactoryAddress,
    addresses.escrowFactoryAddress,
    addresses.multiTokenFactoryAddress,
    addresses.rampSettlementFactoryAddress
  );
}

/** Stellar-only tools: a `StellarAdapter`, or a clear error on EVM. */
export function stellarAdapterFor(args: ConnectionArgs, opts: { readOnly?: boolean } = {}): StellarAdapter {
  if (!isStellar(args)) {
    throw new Error("This tool is Stellar-only — pass network: \"stellar\" or \"stellar-testnet\"");
  }
  return adapterFor(args, {}, opts) as StellarAdapter;
}

/** A `TokenFactory` for the given connection. */
export function tokenFactoryFor(args: ConnectionArgs, addresses: FactoryAddresses): TokenFactory {
  if (isStellar(args)) {
    return new TokenFactory(stellarConfig(args, addresses, false) as AnkaraChainConfig);
  }
  const w = evmWallet(args);
  return new TokenFactory({
    network: networkOf(args) as EVMSupportedNetwork,
    signer: w,
    provider: w.provider as ethers.Provider,
    ...addresses,
  });
}

/** The address transactions are signed from. */
export async function signerAddress(args: ConnectionArgs): Promise<string> {
  if (isStellar(args)) return stellarAdapterFor(args).getSignerAddress();
  return evmWallet(args).address;
}
