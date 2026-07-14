import type { IndexedEvent, EventQueryFilter, RegisteredWebhook } from "../types";

/**
 * IndexerClient
 *
 * Thin HTTP client for a running `@ankarachain/indexer` service — queries
 * the indexed on-chain event history and manages webhook subscriptions.
 * Talks to the indexer's own REST API, not to any chain directly (that's
 * the indexer service's job, polling Soroban RPC in the background).
 *
 * @example
 * ```typescript
 * const indexer = new IndexerClient("http://localhost:4100");
 *
 * const { events } = await indexer.queryEvents({ contract: vaultAddress, type: "opened" });
 * const webhook = await indexer.registerWebhook("https://myapp.com/hooks/ankara", ["opened", "liquidat"]);
 * // webhook.secret is shown exactly once — store it to verify the X-Ankara-Signature header on deliveries.
 * ```
 */
export class IndexerClient {
  private _baseUrl: string;

  constructor(baseUrl: string) {
    this._baseUrl = baseUrl.replace(/\/$/, "");
  }

  async queryEvents(filter: EventQueryFilter = {}): Promise<IndexedEvent[]> {
    const params = new URLSearchParams();
    if (filter.contract) params.set("contract", filter.contract);
    if (filter.type) params.set("type", filter.type);
    if (filter.since != null) params.set("since", String(filter.since));
    if (filter.limit != null) params.set("limit", String(filter.limit));

    const res = await fetch(`${this._baseUrl}/events?${params.toString()}`);
    if (!res.ok) {
      throw new Error(`Indexer query failed: ${res.status} ${await res.text()}`);
    }
    const { events } = (await res.json()) as { events: IndexedEvent[] };
    return events;
  }

  /** `events` is a list of event-type names to match (e.g. `["opened", "liquidat"]`), or `["*"]` for all events. */
  async registerWebhook(url: string, events: string[]): Promise<RegisteredWebhook> {
    const res = await fetch(`${this._baseUrl}/webhooks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, events }),
    });
    if (!res.ok) {
      throw new Error(`Webhook registration failed: ${res.status} ${await res.text()}`);
    }
    return res.json() as Promise<RegisteredWebhook>;
  }

  /** Secrets are never returned here — only at registration time. */
  async listWebhooks(): Promise<RegisteredWebhook[]> {
    const res = await fetch(`${this._baseUrl}/webhooks`);
    if (!res.ok) {
      throw new Error(`Listing webhooks failed: ${res.status} ${await res.text()}`);
    }
    const { webhooks } = (await res.json()) as { webhooks: RegisteredWebhook[] };
    return webhooks;
  }

  async removeWebhook(webhookId: string): Promise<boolean> {
    const res = await fetch(`${this._baseUrl}/webhooks/${encodeURIComponent(webhookId)}`, { method: "DELETE" });
    if (!res.ok) {
      throw new Error(`Removing webhook failed: ${res.status} ${await res.text()}`);
    }
    const { removed } = (await res.json()) as { removed: boolean };
    return removed;
  }
}
