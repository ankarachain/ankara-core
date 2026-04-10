# Ankara Chain SDK

> The open-source RWA tokenization infrastructure.
> Built by [Cranebolt Technologies](https://cranebolt.com) · MIT Licensed

## Monorepo Structure
ankarachain/
├── packages/
│   ├── contracts/   # Solidity smart contracts (Hardhat)
│   ├── sdk/         # TypeScript SDK (@ankarachain/sdk)
│   └── cli/         # CLI tool (npx ankara)
└── apps/
└── docs/        # Documentation site

## Quick Start
```bash
git clone https://github.com/cranebolt/ankarachain
cd ankarachain
npm install
npm run compile
npm run test:contracts
```
