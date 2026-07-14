import { rpc, scValToNative } from "@stellar/stellar-sdk";
import type { IndexerConfig } from "./config";
import { IndexerDb, type IndexedEvent } from "./db";
import { deliverToWebhooks } from "./webhooks";

const CURSOR_KEY = "soroban-events";

/**
 * Polls Soroban RPC's `getEvents` for the configured contract IDs — NOT
 * classic Horizon's SSE stream, which only covers classic ledger
 * operations/effects, not Soroban contract events. `getEvents` only
 * retains a limited recent-ledger window (RPC-provider-dependent, commonly
 * ~7 days), same retention constraint any Soroban indexer has to live with.
 *
 * This has been implemented against the documented `getEvents` request/
 * response shape (`@stellar/stellar-sdk`'s `rpc.Api.GetEventsRequest`/
 * `GetEventsResponse`), not exercised against a live RPC endpoint yet —
 * verify against real testnet traffic before relying on this in production,
 * same caveat as `StellarAnchorProvider`.
 */
export class EventPoller {
  private _server: rpc.Server;
  private _db: IndexerDb;
  private _config: IndexerConfig;
  private _timer?: ReturnType<typeof setInterval>;

  constructor(db: IndexerDb, config: IndexerConfig) {
    this._db = db;
    this._config = config;
    this._server = new rpc.Server(config.rpcUrl);
  }

  start(): void {
    if (this._config.contracts.length === 0) {
      console.warn("[indexer] no contracts configured (INDEXER_CONTRACTS env var, or deployments.testnet.json) — poller idle.");
      return;
    }
    void this._tick();
    this._timer = setInterval(() => void this._tick(), this._config.pollIntervalMs);
  }

  stop(): void {
    if (this._timer) clearInterval(this._timer);
  }

  private async _tick(): Promise<void> {
    try {
      const cursor = this._db.getCursor(CURSOR_KEY);
      const filters = [{ type: "contract" as const, contractIds: this._config.contracts }];

      const response = cursor
        ? await this._server.getEvents({ filters, cursor, limit: 100 })
        : await this._server.getEvents({
            filters,
            startLedger: await this._startLedger(),
            limit: 100,
          });

      for (const raw of response.events) {
        const event = decodeEvent(raw);
        const isNew = this._db.insertEvent(event);
        if (isNew) await deliverToWebhooks(this._db, event);
      }
      if (response.cursor) {
        this._db.setCursor(CURSOR_KEY, response.cursor);
      }
    } catch (err) {
      console.error("[indexer] poll tick failed:", (err as Error).message);
    }
  }

  private async _startLedger(): Promise<number> {
    const latest = await this._server.getLatestLedger();
    return Math.max(1, latest.sequence - this._config.initialLedgerLookback);
  }
}

interface RawSorobanEvent {
  id: string;
  contractId?: { toString(): string } | string;
  ledger: number;
  ledgerClosedAt: string;
  txHash: string;
  topic: unknown[];
  value: unknown;
}

/**
 * Soroban events conventionally carry the event name as `topic[0]` (a
 * Symbol, e.g. "opened"/"funded"/"price_set" — see every contract's
 * `env.events().publish((symbol_short!("x"), ...), data)` call across
 * `contracts-stellar`). Falls back to "unknown" for events that don't
 * follow that convention rather than throwing, since a malformed one event
 * shouldn't take down the whole poll tick.
 */
export function decodeEvent(raw: RawSorobanEvent): IndexedEvent {
  const topics = (raw.topic ?? []).map((t) => scValToNative(t as never));
  const eventType = typeof topics[0] === "string" ? topics[0] : "unknown";
  const contract = typeof raw.contractId === "string" ? raw.contractId : raw.contractId?.toString() ?? "unknown";

  return {
    id: raw.id,
    contract,
    eventType,
    ledger: raw.ledger,
    txHash: raw.txHash,
    timestamp: Math.floor(new Date(raw.ledgerClosedAt).getTime() / 1000),
    data: {
      topics: topics.slice(1),
      value: scValToNative(raw.value as never),
    },
  };
}
