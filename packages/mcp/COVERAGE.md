# SDK ↔ MCP ↔ CLI coverage audit

Maps every public method on the SDK's core classes to the MCP tool and the CLI command
that exposes it (ankarachain/ankara-core#10). ✅ = covered, — = not exposed.
Chain column: **both** = works on EVM and Stellar through the tool's
`network` argument; **stellar** = Stellar-only because the contract only exists there.

Last audited against `main` @ `34e89ee` plus this change.

## Summary

| Class | Methods | MCP covers | CLI covers |
|---|---:|---:|---:|
| `TokenFactory` | 25 | 13 | 12 |
| `AssetRegistry` | 38 | 32 | 8 |
| `EscrowManager` | 22 | 17 | 16 |
| `RampManager` | 12 | 9 | 9 |
| `CollateralVault` | 17 | 11 | 0 |
| `IndexerClient` | 4 | 1 | 0 |

Before this change, the MCP server was EVM-only (`network` hardcoded to `localhost`),
`deploy_token` only handled `farmland`, and there were no tools for `AssetRegistry`
template actions, pool deposit/withdraw, oracle prices, commodity batches, or
`CollateralVault`.

---

## TokenFactory

| Method | MCP tool | CLI | Chain |
|---|---|---|---|
| `deployFarmland` / `deployCommodity` / `deployRealEstate` / `deployInvoice` / `deployCarbonCredit` / `deployMiningRights` | `deploy_token` (all 6, metadata via `get_template_fields`) | `deploy` | both |
| `deployFarmlandNFT` / `deployRealEstateNFT` / `deployMiningRightsNFT` / `deployCommodityVaultNFT` | `deploy_nft` | `deploy-nft` | both |
| `deployEscrow` | `deploy_escrow` | `deploy-escrow` | both |
| `deployCommodityBatchToken` | `deploy_batch_token` | `deploy-batch` | both |
| `deployPoolVault` | `deploy_pool_vault` | `deploy-pool` | both |
| `deployRampSettlement` | `deploy_ramp_settlement` | `deploy-ramp-settlement` | both |
| `getDeployedTokens` | `list_deployments` | — (`status` reads the local config) | both |
| `totalDeployed` | — | — | |
| `getDeployedNFTs` / `totalDeployedNFTs` | — | — | |
| `getDeployedEscrows` / `totalDeployedEscrows` | — | — | |
| `getDeployedMultiTokens` / `totalDeployedMultiTokens` | — | — | |
| `getDeployedRampSettlements` / `totalDeployedRampSettlements` | — | — | |
| `getBalance` (native XLM / ETH) | — | — | |

## AssetRegistry

| Method | MCP tool | CLI | Chain |
|---|---|---|---|
| `getName` / `getSymbol` / `getStatus` / `getCountryCode` / `getVersion` / `getValuationUSD` | `get_asset_details`, `get_token_status` | `status` | both |
| `getTotalSupply` / `getIdentityVerifier` / `getMetadata` | `get_asset_details` | — | both |
| `getBalanceOf` | `get_token_balance` | — | both |
| `setStatus` | `set_asset_status`, `asset_action set_status` | — | both |
| `setIdentityVerifier` | `asset_action set_identity_verifier` | — | both |
| `mint` | `mint_tokens`, `asset_action mint` | `mint` | both |
| `pause` / `unpause` | `asset_action pause/unpause` | — | both |
| `updateValuation` | `asset_action update_valuation` | — | both |
| `updateOccupancyStatus` / `declareRentalDistribution` | `asset_action …` | — | both |
| `isExpired` / `markExpired` | `get_asset_details` / `asset_action mark_expired` | — | both |
| `getInvoiceStatus` / `isOverdue` | `get_asset_details` | — | both |
| `markFunded` / `markRepaid` / `markDefaulted` | `asset_action …` | — | both |
| `retire` | `asset_action retire` | — | both |
| `getTotalRetired` / `getTotalRetirements` | `get_asset_details` | — | both |
| `getRetirement(index)` | — | — | |
| `isLicenseExpired` | `get_asset_details` | — | both |
| `renewLicense` / `markLicenseExpired` / `declareRoyalty` | `asset_action …` | — | both |
| `getTokenMetadata` / `getTokenVersion` / `ownerOf` (NFT) | — | — | |
| `linkToERC20` (NFT) | — | — | |
| *(IAdapter)* `genericTransferToken` / `genericTransferNFT` | `transfer_tokens` / `transfer_nft` | `transfer` | both |

## EscrowManager

| Method | MCP tool | CLI | Chain |
|---|---|---|---|
| `getPayer` / `getPayee` / `getArbiter` / `getToken` / `getTotalAmount` / `isFunded` / `isCancelled` / `milestoneCount` / `getMilestone` / `getAllMilestones` / `remainingBalance` | `get_escrow_status` | `escrow-status` | both |
| `fund(milestoneId)` | `fund_escrow` (one or all unfunded) | `escrow-fund` | both |
| `markDelivered` | `mark_milestone_delivered` | `escrow-deliver` | both |
| `approveMilestone` | `approve_milestone` | `escrow-approve` | both |
| `raiseDispute` | `raise_dispute` | `escrow-dispute` | both |
| `resolveDispute` | `resolve_dispute` | `escrow-resolve` | both |
| `claimTimelockRelease` | `claim_timelock_release` | `escrow-claim-timelock` | both |
| `voteCancel` | `vote_cancel_escrow` | — | both |
| `getActivity` | — | — | |
| `setArbiter` / `setIdentityVerifier` / `pause` / `unpause` | — | — | |

## RampManager

| Method | MCP tool | CLI | Chain |
|---|---|---|---|
| `getQuote` | `get_ramp_quote` (ManualRampProvider only) | `ramp-quote` | n/a |
| `initiateOnRamp` | `initiate_onramp` (ManualRampProvider only) | `onramp-initiate` | n/a |
| `initiateOffRamp` + `depositOffRamp` | `initiate_offramp` | `offramp-initiate` | both |
| `confirmOffRampSettlement` | `confirm_offramp_settlement` | `offramp-confirm` | both |
| `refundOffRamp` | `refund_offramp` | `offramp-refund` | both |
| `recordOnRampSettlement` | `record_onramp_settlement` | `onramp-record` | both |
| `getOffRampDeposit` / `getOnRampRecord` | `get_ramp_status` | `ramp-status` | both |
| `getStatus` (provider session) | — | — | |
| `withProviders` / `connectAnchor` (real providers: Stellar anchors, MoonPay) | — | — | |

## CollateralVault (Stellar-only contract)

| Method | MCP tool | CLI |
|---|---|---|
| `openLoan` | `vault_open_loan` | — |
| `repayLoan` | `vault_repay_loan` | — |
| `liquidate` | `vault_liquidate` | — |
| `getLoan` / `currentLtvBps` / `isLiquidatable` | `get_loan` (with `loanId`) | — |
| `getBorrowedToken` / `getOracle` / `getLtvBps` / `getLiquidationThresholdBps` / `isPaused` | `get_loan` (without `loanId`) | — |
| `getBorrowerLoans` | — | — |
| `setLtvBps` / `setLiquidationThresholdBps` / `setOracle` / `pause` / `unpause` | — | — |

## IndexerClient

| Method | MCP tool | CLI |
|---|---|---|
| `queryEvents` | `query_indexer_events` | — |
| `registerWebhook` / `listWebhooks` / `removeWebhook` | — | — |

## Other IAdapter surface

| Method | MCP tool | CLI | Chain |
|---|---|---|---|
| `batchRegister` / `batchMint` | `batch_register` / `batch_mint` | `register-batch` / `batch-mint` | both |
| `poolDeposit` / `poolWithdraw` / `poolGetStatus` | `pool_deposit` / `pool_withdraw` / `get_pool_status` | `deposit` / `withdraw` / `pool-status` | both |
| `oracleSetPrice` | `oracle_set_price` | `oracle-set` | both |

---

## Remaining gaps (follow-up)

Tracked in the follow-up issue linked from the PR that added this file:

1. **Deployment listings**: `totalDeployed`, and the NFT / escrow / multi-token / ramp
   `getDeployed*` + `totalDeployed*` reads (MCP and CLI).
2. **NFT registry reads/writes**: `getTokenMetadata`, `getTokenVersion`, `ownerOf`,
   `linkToERC20`, and `getRetirement(index)` (MCP and CLI).
3. **Escrow admin**: `setArbiter`, `setIdentityVerifier`, `pause`, `unpause`,
   `getActivity` (MCP and CLI), and `voteCancel` (CLI).
4. **CollateralVault**: borrower commands in the CLI (`open`/`repay`/`liquidate`/`loan`),
   plus admin setters and `getBorrowerLoans` in both.
5. **Real ramp providers in MCP**: expose `createRampProvider` selections
   (`stellar-anchor`, `moonpay`) instead of `ManualRampProvider` only, plus
   `RampManager.getStatus`.
6. **AssetRegistry template actions in the CLI**: `update-valuation`, `retire`,
   `declare-royalty`, `mark-*`, `pause` and so on (the MCP now has these through
   `asset_action`).
7. **Indexer webhooks**: `registerWebhook` / `listWebhooks` / `removeWebhook` (MCP and CLI).
8. **New Stellar primitives from the other open feature PRs** (identity/attestations,
   reserve + compliance, SEP-40 oracle, payments, RWA distribution/RFQ, lending, insurance,
   pool governance). Each adds an SDK class that will need matching MCP tools and CLI
   commands once merged.
