import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { IndexerDb } from "./db";
import { generateWebhookSecret } from "./webhooks";

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, (_key, value) => (typeof value === "bigint" ? value.toString() : value));
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Minimal hand-rolled router — four routes don't justify pulling in Express
 * or another HTTP framework as a dependency.
 */
export function createIndexerServer(db: IndexerDb) {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");

      if (req.method === "GET" && url.pathname === "/health") {
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === "GET" && url.pathname === "/events") {
        const events = db.queryEvents({
          contract: url.searchParams.get("contract") ?? undefined,
          type: url.searchParams.get("type") ?? undefined,
          since: url.searchParams.has("since") ? Number(url.searchParams.get("since")) : undefined,
          limit: url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined,
        });
        return sendJson(res, 200, { events });
      }

      if (req.method === "GET" && url.pathname === "/webhooks") {
        // Secrets are never returned once created — only shown at registration time.
        const webhooks = db.listWebhooks().map(({ secret: _secret, ...rest }) => rest);
        return sendJson(res, 200, { webhooks });
      }

      if (req.method === "POST" && url.pathname === "/webhooks") {
        const body = JSON.parse(await readBody(req)) as { url?: string; events?: string[] };
        if (!body.url || !Array.isArray(body.events) || body.events.length === 0) {
          return sendJson(res, 400, { error: "Request body must include `url` (string) and `events` (non-empty string array; use [\"*\"] for all events)." });
        }
        const webhook = {
          id: randomUUID(),
          url: body.url,
          events: body.events,
          secret: generateWebhookSecret(),
          createdAt: Math.floor(Date.now() / 1000),
        };
        db.addWebhook(webhook);
        // Secret is returned exactly once — the caller must store it to verify future deliveries' X-Ankara-Signature header.
        return sendJson(res, 201, webhook);
      }

      const webhookIdMatch = url.pathname.match(/^\/webhooks\/([^/]+)$/);
      if (req.method === "DELETE" && webhookIdMatch) {
        const removed = db.removeWebhook(webhookIdMatch[1]);
        return sendJson(res, removed ? 200 : 404, { removed });
      }

      sendJson(res, 404, { error: "Not found" });
    } catch (err) {
      sendJson(res, 500, { error: (err as Error).message });
    }
  });
}
