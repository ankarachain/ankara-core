import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type { IndexerDb, IndexedEvent, StoredWebhook } from "./db";

export function generateWebhookSecret(): string {
  return randomBytes(32).toString("hex");
}

/** `sha256=<hex hmac>` over the raw JSON body — the same shape GitHub/Stripe use, so existing webhook-verification middleware on the receiving end is easy to reuse. */
export function signPayload(secret: string, rawBody: string): string {
  return "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
}

function webhookMatches(webhook: StoredWebhook, event: IndexedEvent): boolean {
  return webhook.events.includes("*") || webhook.events.includes(event.eventType);
}

/**
 * Delivers `event` to every registered webhook whose event-type filter
 * matches. Best-effort, fire-and-forget per webhook — a slow or failing
 * endpoint doesn't block the poll loop or other webhooks. No retry queue in
 * v1 (see plan: keep this a plain HTTP POST, no new polling/queue
 * infrastructure) — a receiver that's down simply misses that delivery.
 */
export async function deliverToWebhooks(db: IndexerDb, event: IndexedEvent): Promise<void> {
  const webhooks = db.listWebhooks().filter((w) => webhookMatches(w, event));
  await Promise.all(
    webhooks.map(async (webhook) => {
      try {
        // event.data may contain bigint (Soroban i128/u64 fields, see
        // poller.ts's decodeEvent) — plain JSON.stringify throws on those.
        // Kept inside this try so a future serialization edge case can't
        // reject the whole Promise.all and abort the poll tick the way an
        // earlier version of this bug did.
        const body = JSON.stringify({ id: randomUUID(), event }, (_key, value) =>
          typeof value === "bigint" ? value.toString() : value
        );
        const signature = signPayload(webhook.secret, body);
        await fetch(webhook.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Ankara-Signature": signature,
          },
          body,
        });
      } catch (err) {
        console.error(`[indexer] webhook delivery to ${webhook.url} failed:`, (err as Error).message);
      }
    })
  );
}
