import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createCodexAuth, needsRefresh } from "../src/connections/codex-auth.ts";
import { fakeFetch, jwt } from "./fake-fetch.ts";

const now = () => Math.floor(Date.now() / 1000);
const idToken = jwt({ "https://api.openai.com/auth": { chatgpt_plan_type: "plus", chatgpt_account_id: "acct-1" } });

function authFile(tokens: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "codex-auth-"));
  const path = join(dir, "auth.json");
  writeFileSync(path, JSON.stringify({ tokens, last_refresh: new Date().toISOString(), ...extra }));
  return path;
}

describe("codex auth", () => {
  it("uses a valid token without refreshing", async () => {
    const path = authFile({ access_token: jwt({ exp: now() + 3600 }), refresh_token: "r1", id_token: idToken });
    const { fetch, requests } = fakeFetch({});
    const auth = await createCodexAuth({ fetch, path }).get();
    expect(auth.accountId).toBe("acct-1");
    expect(auth.planType).toBe("plus");
    expect(requests).toHaveLength(0);
  });

  it("refreshes an expiring token and writes the rotated tokens back", async () => {
    const path = authFile({ access_token: jwt({ exp: now() + 10 }), refresh_token: "r1", id_token: idToken }, { custom: "kept" });
    const fresh = jwt({ exp: now() + 3600 });
    const { fetch, requests } = fakeFetch({
      "POST auth.openai.com/oauth/token": () => ({ json: { access_token: fresh, refresh_token: "r2" } }),
    });
    const auth = await createCodexAuth({ fetch, path }).get();
    expect(auth.accessToken).toBe(fresh);
    expect(requests[0]!.body).toMatchObject({ grant_type: "refresh_token", refresh_token: "r1" });
    const saved = JSON.parse(readFileSync(path, "utf8"));
    expect(saved.tokens.refresh_token).toBe("r2");
    expect(saved.custom).toBe("kept");
  });

  it("shares one refresh between concurrent callers", async () => {
    const path = authFile({ access_token: jwt({ exp: now() - 5 }), refresh_token: "r1" });
    const { fetch, requests } = fakeFetch({
      "POST auth.openai.com/oauth/token": () => ({ json: { access_token: jwt({ exp: now() + 3600 }) } }),
    });
    const client = createCodexAuth({ fetch, path });
    await Promise.all([client.get(), client.get(), client.get()]);
    expect(requests).toHaveLength(1);
  });

  it("asks for a new login when the refresh token is refused", async () => {
    const path = authFile({ access_token: jwt({ exp: now() - 5 }), refresh_token: "used" });
    const { fetch } = fakeFetch({ "POST auth.openai.com/oauth/token": () => ({ status: 401, json: { error: "invalid_grant" } }) });
    await expect(createCodexAuth({ fetch, path }).get()).rejects.toThrow(/codex login/);
  });

  it("reports status from the file only", async () => {
    const path = authFile({ access_token: jwt({ exp: now() + 3600 }), refresh_token: "r1", id_token: idToken });
    const { fetch, requests } = fakeFetch({});
    const status = await createCodexAuth({ fetch, path }).status();
    expect(status).toMatchObject({ loggedIn: true, planType: "plus", hasRefreshToken: true, problem: null });
    expect(requests).toHaveLength(0);
  });

  it("explains a missing login", async () => {
    const { fetch } = fakeFetch({});
    const status = await createCodexAuth({ fetch, path: join(tmpdir(), "definitely-missing", "auth.json") }).status();
    expect(status.loggedIn).toBe(false);
    expect(status.problem).toMatch(/codex login/);
  });

  it("refreshes a token whose last refresh is older than 8 days", () => {
    const old = new Date(Date.now() - 9 * 86_400_000).toISOString();
    expect(needsRefresh({ tokens: { access_token: jwt({ exp: now() + 3600 }) }, last_refresh: old })).toBe(true);
  });
});
