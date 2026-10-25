// Starts the local Marinara staging clone (vendor/Marinara-Engine) on a test port
// with its own throwaway data directory, for import/integration tests.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const engine = join(root, "vendor", "Marinara-Engine");
const dataDir = join(root, "vendor", "marinara-test-data");
mkdirSync(dataDir, { recursive: true });

const child = spawn(process.execPath, ["scripts/run-server.mjs", "packages/server/dist/index.js"], {
  cwd: engine,
  stdio: "inherit",
  env: { ...process.env, PORT: process.env.PORT ?? "7870", HOST: "127.0.0.1", DATA_DIR: dataDir },
});
child.on("exit", (code) => process.exit(code ?? 0));
