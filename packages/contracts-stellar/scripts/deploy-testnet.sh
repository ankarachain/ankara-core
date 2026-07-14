#!/usr/bin/env bash
# Deploys the 5 Soroban factory contracts + the AnkaraFactoryRegistry to Stellar
# testnet, initializes each one, and registers the 5 sub-factories into the
# registry. Run this yourself from a terminal you control — it reads your
# signing key from a stellar-cli identity, never as a script argument.
#
# Addresses are also written to ../deployments.testnet.json (overwritten on
# every run) — commit that file, and update ../DEPLOYMENTS.md to match, after
# each deploy so the addresses are never only in your terminal scrollback.
#
# One-time setup (do this once, interactively — it stores the secret in
# stellar-cli's own local keystore, not in shell history or this script):
#
#   stellar keys add deployer --network testnet
#   # (paste your secret key at the prompt)
#
# Then run:
#
#   ./scripts/deploy-testnet.sh deployer
#
set -euo pipefail

IDENTITY="${1:-deployer}"
NETWORK="testnet"
WASM_DIR="target/wasm32v1-none/release"
OWNER="$(stellar keys address "$IDENTITY")"

echo "Deployer identity: $IDENTITY ($OWNER)"
echo "Network: $NETWORK"
echo

deploy() {
  local wasm_file="$1"
  stellar contract deploy \
    --wasm "$WASM_DIR/$wasm_file" \
    --source "$IDENTITY" \
    --network "$NETWORK" \
    2>/dev/null
}

invoke() {
  local contract_id="$1"; shift
  stellar contract invoke \
    --id "$contract_id" \
    --source "$IDENTITY" \
    --network "$NETWORK" \
    -- "$@"
}

echo "Deploying TokenFactory..."
TOKEN_FACTORY=$(deploy token_factory.wasm)
invoke "$TOKEN_FACTORY" initialize --owner "$OWNER" --fee_recipient "$OWNER"
echo "  -> $TOKEN_FACTORY"

echo "Deploying NFTFactory..."
NFT_FACTORY=$(deploy nft_factory.wasm)
invoke "$NFT_FACTORY" initialize --owner "$OWNER" --fee_recipient "$OWNER"
echo "  -> $NFT_FACTORY"

echo "Deploying MultiTokenFactory..."
MULTI_TOKEN_FACTORY=$(deploy multi_token_factory.wasm)
invoke "$MULTI_TOKEN_FACTORY" initialize --owner "$OWNER" --fee_recipient "$OWNER"
echo "  -> $MULTI_TOKEN_FACTORY"

echo "Deploying EscrowFactory..."
ESCROW_FACTORY=$(deploy escrow_factory.wasm)
invoke "$ESCROW_FACTORY" initialize --owner "$OWNER" --fee_recipient "$OWNER"
echo "  -> $ESCROW_FACTORY"

echo "Deploying RampSettlementFactory..."
RAMP_FACTORY=$(deploy ramp_settlement_factory.wasm)
invoke "$RAMP_FACTORY" initialize --owner "$OWNER" --fee_recipient "$OWNER"
echo "  -> $RAMP_FACTORY"

echo "Deploying AnkaraFactoryRegistry..."
REGISTRY=$(deploy ankara_factory_registry.wasm)
invoke "$REGISTRY" initialize --owner "$OWNER"
echo "  -> $REGISTRY"

# CollateralVault needs a borrowed asset to lend out. There's no testnet USDC
# issuer wired into this repo — using the native XLM Stellar Asset Contract as
# a demo stand-in, resolved deterministically (not hardcoded/guessed) via the
# stellar-cli itself. Swap this for a real stablecoin's SAC before any
# non-demo use.
echo "Resolving native XLM Stellar Asset Contract (CollateralVault's borrowed asset for this testnet demo)..."
BORROWED_TOKEN=$(stellar contract id asset --asset native --network "$NETWORK" --source "$IDENTITY")
echo "  -> $BORROWED_TOKEN"

echo "Deploying ManualOracle..."
ORACLE=$(deploy manual_oracle.wasm)
invoke "$ORACLE" initialize --admin "$OWNER" --staleness_threshold 86400
echo "  -> $ORACLE"

# 60% LTV / 75% liquidation threshold — see CollateralVault's plan notes for
# the reasoning; adjust with set_ltv_bps/set_liquidation_threshold_bps later.
echo "Deploying CollateralVault..."
VAULT=$(deploy collateral_vault.wasm)
invoke "$VAULT" initialize --admin "$OWNER" --borrowed_token "$BORROWED_TOKEN" --oracle "$ORACLE" --ltv_bps 6000 --liquidation_threshold_bps 7500
echo "  -> $VAULT"

# The dashboard's Settings page only needs the 5 factory addresses below, not
# the registry or the oracle/vault — print them now, before the registry-
# registration step, so a problem there (see note below) doesn't cost you the
# addresses you actually need.
echo
echo "Paste these into the dashboard's Settings page:"
echo
echo "  Token Factory Address:           $TOKEN_FACTORY"
echo "  NFT Factory Address:             $NFT_FACTORY"
echo "  Multi-Token Factory Address:     $MULTI_TOKEN_FACTORY"
echo "  Escrow Factory Address:          $ESCROW_FACTORY"
echo "  Ramp Settlement Factory Address: $RAMP_FACTORY"
echo "  (Registry, not used by the dashboard yet):        $REGISTRY"
echo "  (ManualOracle, not used by the dashboard yet):     $ORACLE"
echo "  (CollateralVault, not used by the dashboard yet):  $VAULT"
echo

# Persist addresses to disk so a lost terminal scrollback never loses them
# again — this file is overwritten on every run; commit it (and update
# DEPLOYMENTS.md to match) after each deploy.
DEPLOY_FILE="$(dirname "$0")/../deployments.testnet.json"
cat > "$DEPLOY_FILE" <<EOF
{
  "network": "$NETWORK",
  "deployer": "$OWNER",
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "contracts": {
    "tokenFactory": "$TOKEN_FACTORY",
    "nftFactory": "$NFT_FACTORY",
    "multiTokenFactory": "$MULTI_TOKEN_FACTORY",
    "escrowFactory": "$ESCROW_FACTORY",
    "rampSettlementFactory": "$RAMP_FACTORY",
    "ankaraFactoryRegistry": "$REGISTRY",
    "manualOracle": "$ORACLE",
    "collateralVault": "$VAULT",
    "collateralVaultBorrowedToken": "$BORROWED_TOKEN"
  }
}
EOF
echo "Wrote addresses to $DEPLOY_FILE"
echo

# Registering sub-factories into the registry is optional bookkeeping (the
# dashboard doesn't read the registry). `factory_type` (the enum) takes a bare
# string, but `factory` (an Option<Address>) needs to be valid JSON — a bare
# address string isn't, so it's passed here as a JSON-quoted string.
echo "Registering sub-factories into the registry (best-effort)..."
set +e
invoke "$REGISTRY" set_factory --factory_type Erc20      --factory "\"$TOKEN_FACTORY\""       || echo "  ! failed: TokenFactory"
invoke "$REGISTRY" set_factory --factory_type Nft         --factory "\"$NFT_FACTORY\""         || echo "  ! failed: NFTFactory"
invoke "$REGISTRY" set_factory --factory_type MultiToken  --factory "\"$MULTI_TOKEN_FACTORY\"" || echo "  ! failed: MultiTokenFactory"
invoke "$REGISTRY" set_factory --factory_type Escrow      --factory "\"$ESCROW_FACTORY\""      || echo "  ! failed: EscrowFactory"
invoke "$REGISTRY" set_factory --factory_type Ramp        --factory "\"$RAMP_FACTORY\""        || echo "  ! failed: RampSettlementFactory"
set -e
