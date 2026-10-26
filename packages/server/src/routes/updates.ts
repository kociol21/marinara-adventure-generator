import type { FastifyPluginAsync } from "fastify";
import type { UpdateInfo } from "@adv/shared";
import packageJson from "../../package.json" with { type: "json" };
import type { FetchFn } from "../connections/http.ts";
import type { createSettingsRepo } from "../repos/settings.ts";

export const RELEASES_URL = "https://api.github.com/repos/kociol21/marinara-adventure-generator/releases/latest";
const CHECK_EVERY_MS = 12 * 60 * 60 * 1000;

/** "0.10.1" > "0.9.3"; a pre-release suffix is ignored. */
export function isNewer(candidate: string, current: string): boolean {
  const parts = (v: string) => v.replace(/^v/, "").split("-")[0]!.split(".").map((n) => Number(n) || 0);
  const a = parts(candidate);
  const b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

/**
 * Asks GitHub for the latest release, at most twice a day, only while "Check for updates" is on.
 * The request carries no data about the user or their adventures. Any failure (offline, private
 * repo, rate limit) just reports no update.
 */
export const updateRoutes: FastifyPluginAsync<{ settings: ReturnType<typeof createSettingsRepo>; fetch: FetchFn }> = async (
  app,
  options,
) => {
  let cache: { at: number; latest: string | null; url: string | null } | null = null;

  app.get("/updates", async (): Promise<UpdateInfo> => {
    const current = packageJson.version;
    if (!options.settings.get().checkForUpdates) return { enabled: false, current, latest: null, url: null, newer: false };
    if (!cache || Date.now() - cache.at > CHECK_EVERY_MS) {
      let latest: string | null = null;
      let url: string | null = null;
      try {
        const res = await options.fetch(RELEASES_URL, {
          headers: { accept: "application/vnd.github+json", "user-agent": "marinara-adventure-generator" },
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const body = (await res.json()) as { tag_name?: unknown; html_url?: unknown };
          if (typeof body.tag_name === "string") latest = body.tag_name.replace(/^v/, "");
          if (typeof body.html_url === "string" && body.html_url.startsWith("https://github.com/")) url = body.html_url;
        }
      } catch {
        // Offline or blocked: no update shown.
      }
      cache = { at: Date.now(), latest, url };
    }
    return { enabled: true, current, latest: cache.latest, url: cache.url, newer: cache.latest !== null && isNewer(cache.latest, current) };
  });
};
