# Ankara Chain SDK

> The open-source RWA tokenization infrastructure for African markets.
> Built by [PIE Drops Studio](https://piedrops.com) · MIT Licensed

## Monorepo Structure
```
ankarachain/
├── packages/
│   ├── contracts-evm/     # Solidity smart contracts (Hardhat + OpenZeppelin UUPS)
│   ├── contracts-stellar/ # Stellar/Soroban contracts (live on testnet)
│   ├── sdk/               # TypeScript SDK (@ankarachain/sdk)
│   ├── cli/               # CLI tool (npx ankara)
│   └── mcp/               # MCP server for AI-assisted deployment (@ankarachain/mcp)
└── apps/
    ├── web/               # Landing page
    └── docs/              # Mintlify documentation site
```

## Quick Start
```bash
git clone https://github.com/ankarachain/ankara-core
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

## Deployed Contracts

### Stellar Testnet

All Soroban contracts are deployed and live on Stellar testnet. Full details in [DEPLOYMENTS.md](packages/contracts-stellar/DEPLOYMENTS.md).

| Contract                    | Address                                                    |
|-----------------------------|------------------------------------------------------------|
| Token Factory               | `CBMBI63UU6KJIZ5KUVP6A3FGMBMS4R3OXSY27NQNK5PPLCWJW7DPSEEF` |
| NFT Factory                 | `CDAMIGCFMFM7O6Q6GYRZKOTZ67L74KGHMSW3IXEZNWWS3JLGHUSSLZC4` |
| Multi-Token Factory         | `CDT6IV4LVZCG55Z7AWLEROBGKYZKIFNGG2FEGNAYQKC735LDI5TSKVVM` |
| Escrow Factory              | `CDF5P3KOAU6RZGUSSA7KPNYEJMCBYAF5TVWELNFSVTM3TYP6EFUXRYVW` |
| Ramp Settlement Factory     | `CCLEC6AKC65VOIL6KMG52YR2Y2K4WHFMY62GX34NOXBKQZY4QJAIFUWC` |
| Manual Oracle               | `CD3I6U4XHTCCSPHAVR44SD3I2D3MATSMNVBORGWXYL6FMQJPDUOSRS56` |
| Collateral Vault            | `CDIUS3CGVFJONWUK3SCK4RFFONENSJ6QRZLNOHHO7EMVPZCCQ3IUSVNB` |

Deployer: `GAF4RGTNO2HKR754HDQRK4UZCPDN7F3T7QPZQE76UAJZSUUDICD43JPS`
Deployed: July 14, 2026

### EVM (Amoy Testnet)

EVM contracts (Solidity) are compiled and tested. Deployment to Polygon Amoy is a future item. See the [deploy script](packages/contracts-evm/scripts/deploy.ts) for the full contract suite.
