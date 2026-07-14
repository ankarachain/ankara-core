import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

export interface IndexedEvent {
  id: string;             // Soroban RPC's own event id — globally unique, used as the idempotency key
  contract: string;
  eventType: string;
  ledger: number;
  txHash: string;
  timestamp: number;      // unix seconds, derived from ledgerClosedAt
  data: unknown;          // decoded event value, JSON-serialized in storage
}

export interface StoredWebhook {
  id: string;
  url: string;
  events: string[];       // event types to match; ["*"] means all
  secret: string;
  createdAt: number;
}

export interface EventQuery {
  contract?: string;
  type?: string;
  since?: number;         // unix seconds
  limit?: number;
}

/** Soroban's i128/u64 values decode to JS `bigint` (see poller.ts's decodeEvent), which JSON.stringify can't serialize natively — stringify to plain decimal text instead, same convention the HTTP layer (server.ts's sendJson) already uses for API responses. */
function stringifyEventData(data: unknown): string {
  return JSON.stringify(data, (_key, value) => (typeof value === "bigint" ? value.toString() : value));
}

export class IndexerDb {
  private _db: Database.Database;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this._db = new Database(path.join(dataDir, "indexer.sqlite"));
    this._db.pragma("journal_mode = WAL");
    this._migrate();
  }

  private _migrate(): void {
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        contract TEXT NOT NULL,
        event_type TEXT NOT NULL,
        ledger INTEGER NOT NULL,
        tx_hash TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_contract ON events(contract);
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);

      CREATE TABLE IF NOT EXISTS webhooks (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        events TEXT NOT NULL,
        secret TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS cursor (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  /** Returns true if the event was newly inserted (false if it already existed — idempotent on `id`). */
  insertEvent(event: IndexedEvent): boolean {
    const result = this._db
      .prepare(
        `INSERT OR IGNORE INTO events (id, contract, event_type, ledger, tx_hash, timestamp, data)
         VALUES (@id, @contract, @eventType, @ledger, @txHash, @timestamp, @data)`
      )
      .run({ ...event, data: stringifyEventData(event.data) });
    return result.changes > 0;
  }

  queryEvents(query: EventQuery): IndexedEvent[] {
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};
    if (query.contract) {
      clauses.push("contract = @contract");
      params.contract = query.contract;
    }
    if (query.type) {
      clauses.push("event_type = @type");
      params.type = query.type;
    }
    if (query.since != null) {
      clauses.push("timestamp >= @since");
      params.since = query.since;
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.min(query.limit ?? 100, 500);
    const rows = this._db
      .prepare(`SELECT * FROM events ${where} ORDER BY ledger ASC, id ASC LIMIT ${limit}`)
      .all(params) as Array<{
        id: string; contract: string; event_type: string; ledger: number;
        tx_hash: string; timestamp: number; data: string;
      }>;
    return rows.map((r) => ({
      id: r.id,
      contract: r.contract,
      eventType: r.event_type,
      ledger: r.ledger,
      txHash: r.tx_hash,
      timestamp: r.timestamp,
      data: JSON.parse(r.data),
    }));
  }

  addWebhook(webhook: StoredWebhook): void {
    this._db
      .prepare(
        `INSERT INTO webhooks (id, url, events, secret, created_at) VALUES (@id, @url, @events, @secret, @createdAt)`
      )
      .run({ ...webhook, events: JSON.stringify(webhook.events) });
  }

  removeWebhook(id: string): boolean {
    return this._db.prepare(`DELETE FROM webhooks WHERE id = ?`).run(id).changes > 0;
  }

  listWebhooks(): StoredWebhook[] {
    const rows = this._db.prepare(`SELECT * FROM webhooks`).all() as Array<{
      id: string; url: string; events: string; secret: string; created_at: number;
    }>;
    return rows.map((r) => ({
      id: r.id, url: r.url, events: JSON.parse(r.events), secret: r.secret, createdAt: r.created_at,
    }));
  }

  getCursor(key: string): string | undefined {
    const row = this._db.prepare(`SELECT value FROM cursor WHERE key = ?`).get(key) as { value: string } | undefined;
    return row?.value;
  }

  setCursor(key: string, value: string): void {
    this._db
      .prepare(`INSERT INTO cursor (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(key, value);
  }

  close(): void {
    this._db.close();
  }
}
