import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { openDatabase } from "./db/database.ts";
import { KeyringSecretStore } from "./secrets/secret-store.ts";

const WEB_DEV_PORT = 5173;

const config = loadConfig();
const db = openDatabase(config.dbPath);
const app = await buildApp({
  db,
  secretStore: new KeyringSecretStore(),
  dataDir: config.dataDir,
  port: config.port,
  trustedPorts: config.production ? [] : [WEB_DEV_PORT],
  webDistDir: config.production ? config.webDistDir : undefined,
  logger: true,
});

const shutdown = async () => {
  await app.close();
  db.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ host: config.host, port: config.port });
