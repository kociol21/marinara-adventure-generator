import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_PORT } from "@adv/shared";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export interface AppConfig {
  /** Always loopback: the app holds API keys and spoilers and is never exposed on the network. */
  host: "127.0.0.1";
  port: number;
  dataDir: string;
  dbPath: string;
  webDistDir: string;
  production: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, argv: string[] = process.argv): AppConfig {
  const port = Number(env.PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`Invalid PORT: ${env.PORT}`);
  const dataDir = resolve(env.DATA_DIR ?? join(repoRoot, "data"));
  mkdirSync(dataDir, { recursive: true });
  return {
    host: "127.0.0.1",
    port,
    dataDir,
    dbPath: join(dataDir, "app.db"),
    webDistDir: join(repoRoot, "packages", "web", "dist"),
    production: env.NODE_ENV === "production" || argv.includes("--production"),
  };
}
