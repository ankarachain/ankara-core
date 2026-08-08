# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Ankara Chain SDK — open-source RWA (Real-World Asset) tokenization infrastructure for African markets, built by PIE Drops Studio. Think "Stripe for asset tokenization": developers plug in the SDK, deploy pre-audited contracts to their own network, and own their infrastructure with no platform lock-in.

## Monorepo Structure

```
packages/
  contracts-evm/   # Solidity smart contracts (Hardhat + OpenZeppelin UUPS)
  sdk/             # TypeScript SDK (@ankarachain/sdk) — the core product
  cli/             # CLI tool (npx ankara) wrapping the SDK
apps/
  web/             # Static landing page
  docs/            # Mintlify documentation site
```

## Commands

### Root (runs across all workspaces)
```bash
npm run build          # Build all packages
npm run test           # Test all packages
npm run test:contracts # Run Hardhat tests only
npm run compile        # Compile Solidity contracts
npm run clean          # Clean all build artifacts
```

### Contracts (`packages/contracts-evm`)
```bash
npm run compile        # hardhat compile
npm run test           # hardhat test
npm run test:coverage  # hardhat coverage
npm run node           # Start local Hardhat node
npm run deploy:local   # Deploy to local node
npm run deploy:amoy    # Deploy to Polygon Amoy testnet
```

### SDK (`packages/sdk`)
```bash
npm run build          # tsup (CJS + ESM dual output)
npm run dev            # tsup --watch
npm run test           # vitest run
npm run test:watch     # vitest (watch mode)
```

### CLI (`packages/cli`)
```bash
npm run build          # tsup (ESM only with shebang)
npm run dev            # tsup --watch
npm run start          # node dist/index.js
```

### Docs (`apps/docs`)
```bash
npm run dev            # mintlify dev
npm run build          # mintlify build
```

## Architecture

### Data Flow
```
User App / CLI
     ↓
TokenFactory (sdk/src/core/TokenFactory.ts)   ← high-level API
     ↓
EVMAdapter   (sdk/src/adapters/evm.ts)        ← ethers.js v6 wrapper
     ↓
Smart Contracts (packages/contracts-evm)
```

### Core SDK Classes

**`TokenFactory`** — primary entry point for deploying tokens. Takes a `SupportedNetwork` and ethers `Signer`. Exposes `deployFarmland()`, `deployCommodity()`, `deployRealEstate()`, `deployInvoice()`, `deployCarbonCredit()`, `deployMiningRights()`.

**`EVMAdapter`** — wraps ethers.js v6. Handles contract instantiation, transaction submission, event parsing, and metadata encoding for on-chain storage. The most complex file (~400 LOC).

**`AssetRegistry`** — reads/writes asset metadata for already-deployed tokens. Manages lifecycle status: `DRAFT → ACTIVE → SUSPENDED → REDEEMED/EXPIRED`.

### Smart Contracts

- **`AnkaraChainBaseToken`** — ERC-20 base using UUPS upgradeable proxy pattern (OpenZeppelin v5)
- **`TokenFactory`** — deploys ERC-1967 proxies pointing to one of 6 template implementations
- **6 Templates**: FarmlandToken, CommodityReceiptToken, RealEstateToken, InvoiceToken, CarbonCreditToken, MiningRightsToken
- **`WhitelistVerifier`** — optional identity verification

### CLI Commands
- `ankara init` — generates `ankara.config.json`
- `ankara deploy-factory` — deploys the TokenFactory contract
- `ankara deploy` — interactive wizard (inquirer prompts) for token deployment
- `ankara status` — query deployed tokens
- `ankara mint` — mint tokens to an address

### SDK Exports
- Core: `TokenFactory`, `AssetRegistry`, `EVMAdapter`
- Types: `SupportedNetwork`, `AssetTemplate`, `Deploy*Options` (one per asset class)
- Utils: `getNetwork`, `NETWORKS`, `ABIs`
- React (separate bundle): `useTokenBalance`, `useAnkaraChain`, `useAsset` — exported from `@ankarachain/sdk/react`

### Supported Networks
Polygon (137, Amoy 80002), Ethereum (1), BNB Smart Chain (56), Celo (42220), localhost Hardhat (31337).

## Key Implementation Details

- **ethers.js v6** is a peer dependency of the SDK (not bundled)
- SDK builds dual CJS + ESM via `tsup`; React hooks are a separate entry point to avoid React being pulled into non-React apps
- Contracts use `viaIR: true` and optimizer `runs: 200`; TypeChain generates typed bindings targeting ethers-v6
- CLI uses ESM only with `#!/usr/bin/env node` banner added by tsup
- Environment variables for contracts: `PRIVATE_KEY`, `ALCHEMY_API_KEY`, `POLYGONSCAN_API_KEY` (see `packages/contracts-evm/.env.example`)
- Node ≥18 required
