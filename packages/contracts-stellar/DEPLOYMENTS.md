# Stellar Testnet Deployments

Source of truth for deployed Soroban contract addresses. As of this commit,
`scripts/deploy-testnet.sh` still only prints addresses to stdout — see
`deployments.testnet.json` (added alongside this file) for the machine-readable
version going forward. Update both files whenever you redeploy.

## testnet

| Contract                    | Address                                                    |
|------------------------------|-------------------------------------------------------------|
| Token Factory                 | `CBMBI63UU6KJIZ5KUVP6A3FGMBMS4R3OXSY27NQNK5PPLCWJW7DPSEEF` |
| NFT Factory                    | `CDAMIGCFMFM7O6Q6GYRZKOTZ67L74KGHMSW3IXEZNWWS3JLGHUSSLZC4` |
| Multi-Token Factory            | `CDT6IV4LVZCG55Z7AWLEROBGKYZKIFNGG2FEGNAYQKC735LDI5TSKVVM` |
| Escrow Factory                 | `CDF5P3KOAU6RZGUSSA7KPNYEJMCBYAF5TVWELNFSVTM3TYP6EFUXRYVW` |
| Ramp Settlement Factory        | `CCLEC6AKC65VOIL6KMG52YR2Y2K4WHFMY62GX34NOXBKQZY4QJAIFUWC` |
| Ankara Factory Registry        | **TODO — not captured.** `deploy-testnet.sh` does print this address (see the "Registry, not used by the dashboard yet" line), but it wasn't saved anywhere before this doc was written. See recovery steps below. |
| Manual Oracle                  | `CD3I6U4XHTCCSPHAVR44SD3I2D3MATSMNVBORGWXYL6FMQJPDUOSRS56` |
| Collateral Vault               | `CDIUS3CGVFJONWUK3SCK4RFFONENSJ6QRZLNOHHO7EMVPZCCQ3IUSVNB` — borrowed asset: native XLM SAC `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` (testnet demo stand-in, see deploy-testnet.sh), 60% LTV / 75% liquidation threshold |

Deployer (factories 1-5): unknown — not captured at deploy time. Deployer (Manual Oracle, Collateral Vault): `GAF4RGTNO2HKR754HDQRK4UZCPDN7F3T7QPZQE76UAJZSUUDICD43JPS`.

**Manual Oracle and Collateral Vault deployed individually** (not via `deploy-testnet.sh`, to avoid redeploying — and thereby orphaning — the 5 already-referenced factory addresses above, since the script has no "deploy only what's missing" mode). Verified live on-chain post-deploy: vault's `borrowed_token`/`oracle`/`ltv_bps`/`liquidation_threshold_bps`/`is_paused` all read back correctly; oracle's `set_price`/`get_price` round-tripped a real price for the native XLM SAC.

## Recovering the missing registry address

Try, in order:
1. Check your terminal scrollback from the original `deploy-testnet.sh` run.
2. Check `stellar-cli`'s local transaction history for the `deployer` identity (`stellar contract` invocations against a contract you don't otherwise recognize, deployed around the same time as the 5 factories above).
3. If unrecoverable, redeploy just the registry:
   ```bash
   stellar contract deploy --wasm target/wasm32v1-none/release/ankara_factory_registry.wasm --source deployer --network testnet
   stellar contract invoke --id <NEW_REGISTRY_ID> --source deployer --network testnet -- initialize --owner <YOUR_ADDRESS>
   ```
   then re-run the `set_factory` registration calls against the 5 factory addresses above (they don't need to change or redeploy).

## Regenerating this file

Every future run of `scripts/deploy-testnet.sh` writes `deployments.testnet.json`
next to this file. After a redeploy, update the table above to match and commit
both files together.
