import { loadConfig } from "./config";
import { IndexerDb } from "./db";
import { EventPoller } from "./poller";
import { createIndexerServer } from "./server";

const config = loadConfig();
const db = new IndexerDb(config.dataDir);
const poller = new EventPoller(db, config);
const server = createIndexerServer(db);

poller.start();
server.listen(config.port, () => {
  console.log(`[indexer] listening on :${config.port}`);
  console.log(`[indexer] watching ${config.contracts.length} contract(s):`, config.contracts);
});

function shutdown(): void {
  console.log("[indexer] shutting down...");
  poller.stop();
  server.close();
  db.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
