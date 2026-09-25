# Design note: fixed-coupon / maturity-redemption instrument

Status: **Decided — new template (`bond-token`), not an `invoice-token` extension.**
Tracking: ankarachain/ankara-core#2 (item 5). Implementation is a follow-up; this note
records the decision and the intended shape.

## Question

Should a multi-period instrument (several coupon payments, then principal
redemption at maturity) be built by extending `invoice-token`, or as a new template?

## Decision: new template

`invoice-token` models a **single receivable**: one face value, one due date, and a
lifecycle of `Pending → Funded → Repaid | Defaulted` (plus `is_overdue`). A coupon bond
differs on every axis that template encodes:

| | invoice-token | coupon instrument |
|---|---|---|
| Cash flows | 1 (face value at due date) | N coupons + principal at maturity |
| Schedule | a single `due_date` | a coupon calendar (`Vec<CouponPeriod>`) |
| Status | Pending/Funded/Repaid/Defaulted | per-coupon Paid/Missed, plus Matured/Redeemed/Defaulted |
| Holder payout | off-chain, to the invoice owner | pro-rata to many holders, every period |
| Default | one event | can happen on any coupon or at maturity |

Extending `invoice-token` would mean either overloading `due_date`/`status` with meanings
that current integrators (SDK `InvoiceMetadata`, the dashboard, the MCP `deploy_token`
tool) don't expect, or bolting on a second, parallel state machine. Both would make the
most-used template harder to reason about. A new template keeps `invoice-token` stable.

## Intended shape of `bond-token`

- A fungible SEP-41 template like the other six: roles, pausable, identity verifier,
  compliance policy, snapshots via `ankara-common`.
- Metadata: `issuer_ref`, `face_value_per_unit`, `coupon_rate_bps`, `coupon_frequency`
  (monthly/quarterly/semiannual/annual), `issue_date`, `maturity_date`, `currency`,
  `prospectus_hash`.
- Coupon calendar, generated at `initialize` from the metadata: `Vec<CouponPeriod {
  due_at, amount_per_unit, status }>`.
- **Payouts reuse `revenue-distributor`.** `pay_coupon(period)` (Manager) creates a
  distribution for `amount_per_unit * total_supply` of the payout token and records its
  distribution id against the period. Holders claim pro-rata at the snapshot, exactly as
  for rent and royalties. The bond only tracks the schedule. It never custodies cash or
  iterates over holders.
- `redeem(holder)` after maturity: burns the holder's units against the principal, which
  is funded into a final distribution. A missed coupon or redemption past a grace period
  sets `Defaulted`, mirroring `invoice-token::mark_defaulted`.
- Registered in `token-factory` as a seventh fungible template, with SDK
  `deployBond()` and `BondMetadata`.

## Why `revenue-distributor` first

The distributor added in the same change is the piece every income-bearing asset needs
(rent, royalties, coupons). With it in place, `bond-token` becomes a scheduling and
lifecycle wrapper, which keeps the new template small.
