// Runs the API server (watch mode) and the Vite dev server together.
import { spawn } from "node:child_process";

const pnpm = ["--yes", "pnpm@12.15.0"];
const procs = [
  spawn("npx", [...pnpm, "--filter", "@adv/server", "dev"], { stdio: "inherit", shell: true }),
  spawn("npx", [...pnpm, "--filter", "@adv/web", "dev"], { stdio: "inherit", shell: true }),
];

const stop = () => procs.forEach((p) => p.kill());
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const p of procs) p.on("exit", (code) => code && (stop(), process.exit(code)));
