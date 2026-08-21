import type {
  NetworkConfig,
  SupportedNetwork,
  EVMSupportedNetwork,
  EVMNetworkConfig,
  StellarSupportedNetwork,
  StellarNetworkConfig,
} from "../types";

export const NETWORKS: Record<SupportedNetwork, NetworkConfig> = {
  "polygon-amoy": {
    chainFamily: "evm",
    chainId: 80002,
    name: "Polygon Amoy Testnet",
    rpcUrl: "https://rpc-amoy.polygon.technology",
    explorerUrl: "https://amoy.polygonscan.com",
    nativeCurrency: { name: "MATIC", symbol: "MATIC", decimals: 18 },
  },
  polygon: {
    chainFamily: "evm",
    chainId: 137,
    name: "Polygon Mainnet",
    rpcUrl: "https://polygon-rpc.com",
    explorerUrl: "https://polygonscan.com",
    nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
  },
  ethereum: {
    chainFamily: "evm",
    chainId: 1,
    name: "Ethereum Mainnet",
    rpcUrl: "https://eth.llamarpc.com",
    explorerUrl: "https://etherscan.io",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
  bnb: {
    chainFamily: "evm",
    chainId: 56,
    name: "BNB Smart Chain",
    rpcUrl: "https://bsc-dataseed.binance.org",
    explorerUrl: "https://bscscan.com",
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  },
  celo: {
    chainFamily: "evm",
    chainId: 42220,
    name: "Celo Mainnet",
    rpcUrl: "https://forno.celo.org",
    explorerUrl: "https://celoscan.io",
    nativeCurrency: { name: "CELO", symbol: "CELO", decimals: 18 },
  },
  "celo-sepolia": {
    chainFamily: "evm",
    chainId: 11142220,
    name: "Celo Sepolia Testnet",
    rpcUrl: "https://forno.celo-sepolia.celo-testnet.org",
    explorerUrl: "https://celo-sepolia.blockscout.com",
    nativeCurrency: { name: "CELO", symbol: "CELO", decimals: 18 },
  },
  localhost: {
    chainFamily: "evm",
    chainId: 31337,
    name: "Hardhat Local",
    rpcUrl: "http://127.0.0.1:8545",
    explorerUrl: "",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
  "stellar-testnet": {
    chainFamily: "stellar",
    networkPassphrase: "Test SDF Network ; September 2015",
    name: "Stellar Testnet",
    rpcUrl: "https://soroban-testnet.stellar.org",
    explorerUrl: "https://stellar.expert/explorer/testnet",
    nativeCurrency: { name: "Lumens", symbol: "XLM", decimals: 7 },
  },
  stellar: {
    chainFamily: "stellar",
    networkPassphrase: "Public Global Stellar Network ; September 2015",
    // Unlike testnet, there's no single official free public Soroban RPC
    // for pubnet — callers deploying to mainnet must override this via
    // `rpcUrl` in AnkaraChainConfig (e.g. a provider like a hosted RPC node).
    rpcUrl: "",
    name: "Stellar Mainnet",
    explorerUrl: "https://stellar.expert/explorer/public",
    nativeCurrency: { name: "Lumens", symbol: "XLM", decimals: 7 },
  },
};

export function getNetwork(network: EVMSupportedNetwork): EVMNetworkConfig;
export function getNetwork(network: StellarSupportedNetwork): StellarNetworkConfig;
export function getNetwork(network: SupportedNetwork): NetworkConfig;
export function getNetwork(network: SupportedNetwork): NetworkConfig {
  const config = NETWORKS[network];
  if (!config) throw new Error(`Unsupported network: ${network}`);
  return config;
}
