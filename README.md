# Ankara Chain SDK

> The open-source RWA tokenization infrastructure for African markets.
> Built by [Cranebolt Technologies](https://cranebolt.com) · MIT Licensed

## Monorepo Structure
```
ankarachain/
├── packages/
│   ├── contracts-evm/     # Solidity smart contracts (Hardhat + OpenZeppelin UUPS)
│   ├── contracts-stellar/ # Stellar/Soroban contracts (Phase 5, not started)
│   ├── sdk/               # TypeScript SDK (@ankarachain/sdk)
│   ├── cli/               # CLI tool (npx ankara)
│   └── mcp/               # MCP server for AI-assisted deployment (@ankarachain/mcp)
└── apps/
    ├── web/               # Landing page
    └── docs/              # Mintlify documentation site
```

## Quick Start
```bash
git clone https://github.com/cranebolt/ankarachain
cd ankarachain
npm install
npm run compile
npm run test:contracts
```

## Commands (root)
```bash
npm run build          # Build all packages
npm run test           # Test all packages
npm run test:contracts # Run Hardhat tests only
npm run compile        # Compile Solidity contracts
npm run clean          # Clean all build artifacts
```

See [CLAUDE.md](./CLAUDE.md) for per-package commands and architecture details.
