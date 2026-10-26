import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_PORT } from "@adv/shared";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export interface AppConfig {
  /**
   * Loopback: the app holds API keys and spoilers and is never exposed on the network.
   * 0.0.0.0 only inside a container, whose port is published on the host's loopback.
   */
  host: "127.0.0.1" | "0.0.0.0";
  port: number;
  dataDir: string;
  dbPath: string;
  webDistDir: string;
  production: boolean;
  /** Where API keys live: the OS credential store, or a file in the data folder (containers). */
  secretStore: "keyring" | "file";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, argv: string[] = process.argv): AppConfig {
  const port = Number(env.PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`Invalid PORT: ${env.PORT}`);
  const host = env.HOST?.trim() || "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "0.0.0.0") throw new Error(`Invalid HOST: ${env.HOST} (use 127.0.0.1, or 0.0.0.0 in Docker)`);
  const secretStore = env.SECRET_STORE?.trim() || "keyring";
  if (secretStore !== "keyring" && secretStore !== "file") throw new Error(`Invalid SECRET_STORE: ${env.SECRET_STORE} (use keyring or file)`);
  const dataDir = resolve(env.DATA_DIR ?? join(repoRoot, "data"));
  mkdirSync(dataDir, { recursive: true });
  return {
    host,
    port,
    dataDir,
    dbPath: join(dataDir, "app.db"),
    webDistDir: join(repoRoot, "packages", "web", "dist"),
    production: env.NODE_ENV === "production" || argv.includes("--production"),
    secretStore,
  };
}
