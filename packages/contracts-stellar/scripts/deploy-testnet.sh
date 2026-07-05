#!/usr/bin/env bash
# Deploys the 5 Soroban factory contracts + the AnkaraFactoryRegistry to Stellar
# testnet, initializes each one, and registers the 5 sub-factories into the
# registry. Run this yourself from a terminal you control — it reads your
# signing key from a stellar-cli identity, never as a script argument.
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

# The dashboard's Settings page only needs the 5 factory addresses below, not
# the registry — print them now, before the registry-registration step, so a
# problem there (see note below) doesn't cost you the addresses you actually need.
echo
echo "Paste these into the dashboard's Settings page:"
echo
echo "  Token Factory Address:           $TOKEN_FACTORY"
echo "  NFT Factory Address:             $NFT_FACTORY"
echo "  Multi-Token Factory Address:     $MULTI_TOKEN_FACTORY"
echo "  Escrow Factory Address:          $ESCROW_FACTORY"
echo "  Ramp Settlement Factory Address: $RAMP_FACTORY"
echo "  (Registry, not used by the dashboard yet): $REGISTRY"
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
