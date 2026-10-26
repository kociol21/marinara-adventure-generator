import { existsSync } from "node:fs";
import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { openDatabase } from "./db/database.ts";
import { FileSecretStore, type SecretStore } from "./secrets/secret-store.ts";

const WEB_DEV_PORT = 5173;

const config = loadConfig();
const db = openDatabase(config.dbPath);
const secretStore: SecretStore =
  config.secretStore === "file"
    ? new FileSecretStore(config.dataDir)
    : new (await import("./secrets/keyring-store.ts")).KeyringSecretStore();
const shutdown = async () => {
  await app.close();
  db.close();
  process.exit(0);
};

const app = await buildApp({
  db,
  secretStore,
  dataDir: config.dataDir,
  port: config.port,
  trustedPorts: config.production ? [] : [WEB_DEV_PORT],
  webDistDir: config.production ? config.webDistDir : undefined,
  logger: true,
  // In Docker the container would only start again; it is stopped with docker compose.
  ...(existsSync("/.dockerenv") ? {} : { stop: () => void shutdown() }),
});
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ host: config.host, port: config.port });
