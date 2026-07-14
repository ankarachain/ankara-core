import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { IndexerDb } from "./db";

describe("IndexerDb", () => {
  let dir: string;
  let db: IndexerDb;

  afterEach(() => {
    db?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function setup(): IndexerDb {
    dir = mkdtempSync(path.join(tmpdir(), "indexer-db-test-"));
    db = new IndexerDb(dir);
    return db;
  }

  it("stores and retrieves an event whose data contains bigint values without throwing", () => {
    const store = setup();
    // Regression test: real Soroban events decode i128/u64 fields to JS
    // bigint (see poller.ts's decodeEvent) — plain JSON.stringify throws on
    // those ("Do not know how to serialize a BigInt"), only caught by
    // testing against a real deployed contract's actual event data.
    const inserted = store.insertEvent({
      id: "0000000001-0000000000",
      contract: "CABC123",
      eventType: "price_set",
      ledger: 100,
      txHash: "deadbeef",
      timestamp: 1_700_000_000,
      data: { topics: [], value: [1_000_000_000_000_000_000n, 1_700_000_000n] },
    });
    expect(inserted).toBe(true);

    const [event] = store.queryEvents({ contract: "CABC123" });
    expect(event.eventType).toBe("price_set");
    expect(event.data).toEqual({ topics: [], value: ["1000000000000000000", "1700000000"] });
  });

  it("insertEvent is idempotent on id", () => {
    const store = setup();
    const event = {
      id: "dup-1",
      contract: "CABC123",
      eventType: "opened",
      ledger: 1,
      txHash: "tx1",
      timestamp: 1,
      data: {},
    };
    expect(store.insertEvent(event)).toBe(true);
    expect(store.insertEvent(event)).toBe(false);
    expect(store.queryEvents({})).toHaveLength(1);
  });
});
