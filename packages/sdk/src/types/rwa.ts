/** Dispute / lien flags on a title NFT (farmland-nft, real-estate-nft). */
export interface TitleFlags {
  disputed: boolean;
  disputeRef: string;
  liened: boolean;
  lienRef: string;
  /** unix seconds; `0n` if never set */
  updatedAt: bigint;
}

/** One append-only chain-of-custody entry on a title NFT. */
export interface CustodyEntry {
  /** Free-form: a name, registry party ID, or address as text. */
  owner: string;
  /** Deed / transfer instrument reference. */
  reference: string;
  effectiveAt: bigint;
  recordedAt: bigint;
  recordedBy: string;
}

/** On-chain `Distribution` from `revenue-distributor`. */
export interface RevenueDistribution {
  id: number;
  assetToken: string;
  payoutToken: string;
  snapshotId: number;
  totalAmount: bigint;
  supplyAtSnapshot: bigint;
  claimedAmount: bigint;
  creator: string;
  createdAt: bigint;
  /** `0n` = no deadline */
  claimDeadline: bigint;
  reclaimed: boolean;
  memo: string;
}

export type RfqIntentStatus = "open" | "filled" | "cancelled";
export type RfqQuoteStatus = "active" | "accepted" | "withdrawn";

export interface RfqIntent {
  id: number;
  seller: string;
  assetToken: string;
  amount: bigint;
  quoteToken: string;
  minTotalPrice: bigint;
  expiresAt: bigint;
  status: RfqIntentStatus;
  createdAt: bigint;
  acceptedQuote: number | null;
}

export interface RfqQuote {
  id: number;
  intentId: number;
  buyer: string;
  totalPrice: bigint;
  expiresAt: bigint;
  status: RfqQuoteStatus;
  createdAt: bigint;
}

export interface PostIntentInput {
  assetToken: string;
  amount: bigint;
  quoteToken: string;
  /** Quotes below this total are rejected; default 0. */
  minTotalPrice?: bigint;
  /** unix seconds */
  expiresAt: bigint;
}
