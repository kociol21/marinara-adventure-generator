import { describe, expect, it } from "vitest";
import type { AdventurePackage } from "@adv/shared";
import { createMarinaraClient } from "../src/marinara/client.ts";
import { pushToMarinara, PushRefusedError } from "../src/marinara/push.ts";
import { probePackage } from "./fixtures/probe-package.ts";
import { fakeFetch } from "./fake-fetch.ts";

const BASE = "http://marinara.test";
const pkg = (): AdventurePackage => ({
  ...structuredClone(probePackage),
  secretPlot: { description: "SECRET_ARC", protagonistArc: "SECRET_PROTAGONIST", sceneDirections: ["SECRET_SCENE"] },
});

/** A Marinara stand-in that hands out ids and remembers chat metadata and Director memory. */
function fakeMarinara(options: { director?: boolean; failOn?: string } = {}) {
  let n = 0;
  const meta: Record<string, unknown> = {};
  let memory: Record<string, unknown> = {};
  const fail = (what: string) => (options.failOn === what ? { status: 500, json: { error: "boom" } } : null);
  const fake = fakeFetch({
    "GET /api/capability-packages/installed": () => ({ json: options.director === false ? [] : [{ id: "director" }] }),
    "POST /api/import/marinara": (req) => fail((req.body as { type: string }).type) ?? { json: { success: true, id: `imp-${++n}` } },
    "PATCH /api/chats/chat-1/metadata": (req) => (Object.assign(meta, req.body), { json: {} }),
    "POST /api/chats/chat-1/messages": () => fail("message") ?? { json: { id: "msg-1" } },
    "POST /api/chats": () => ({ json: { id: "chat-1" } }),
    "GET /api/chats/chat-1": () => ({ json: { id: "chat-1", metadata: meta } }),
    "PATCH /api/agents/memory/director/chat-1": (req) => ((memory = { ...memory, ...(req.body as { patch: object }).patch }), { json: { memory } }),
    "GET /api/agents/memory/director/chat-1": () => ({ json: { memory } }),
    "POST /api/lorebooks/": () => fail("vectorize") ?? { json: { vectorized: 3, total: 4 } },
    "DELETE /api/": () => ({ status: 200, text: "" }),
  });
  return { ...fake, meta, memory: () => memory };
}

const client = (fake: ReturnType<typeof fakeMarinara>, credentials = { username: "u", password: "pass-word-123" }) =>
  createMarinaraClient({ baseUrl: BASE, credentials, fetch: fake.fetch });
const opts = { withoutSecretPlot: false, vectorConnectionId: null, connectionId: null, promptPresetId: null };

describe("Push to Marinara", () => {
  it("imports, creates the chat, seeds the Secret Plot with its start marker and verifies it", async () => {
    const fake = fakeMarinara();
    const record = await pushToMarinara(client(fake), BASE, pkg(), {}, opts);
    expect(record.status).toBe("done");
    expect(record.secretPlot).toBe("seeded");
    expect(record.steps.map((s) => `${s.id}:${s.status}`)).toEqual([
      "characters:ok",
      "persona:ok",
      "lorebooks:ok",
      "chat:ok",
      "settings:ok",
      "opening:ok",
      "secret-plot:ok",
      "verify:ok",
    ]);
    expect(fake.meta).toMatchObject({ activeLorebookIds: ["imp-4", "imp-5"], enableAgents: true, activeAgentIds: ["director"], narrativeDirectorSecretPlotEnabled: true });
    expect(fake.memory()).toMatchObject({ overarchingArc: { description: "SECRET_ARC", completed: false }, secretPlotLastAssistantMessageId: "msg-1" });
    const chat = fake.requests.find((r) => r.method === "POST" && r.url.endsWith("/api/chats"))!;
    // The opening card is listed first; the persona is selected.
    expect(chat.body).toMatchObject({ mode: "roleplay", characterIds: ["imp-1", "imp-2"], personaId: "imp-3" });
    expect(fake.requests.every((r) => r.headers.authorization === `Basic ${Buffer.from("u:pass-word-123").toString("base64")}`)).toBe(true);
    // The record is safe to store and show: no story text.
    expect(JSON.stringify(record)).not.toMatch(/SECRET_|ALPHA_FIRST_MESSAGE/);
  });

  it("creates the chat with the chosen connection and preset", async () => {
    const fake = fakeMarinara();
    const record = await pushToMarinara(client(fake), BASE, pkg(), {}, { ...opts, connectionId: "conn-9", promptPresetId: "preset-3", chatSetupLabel: "Main (m1), Preset" });
    const chat = fake.requests.find((r) => r.method === "POST" && r.url.endsWith("/api/chats"))!;
    expect(chat.body).toMatchObject({ connectionId: "conn-9", promptPresetId: "preset-3" });
    expect(record.steps.find((s) => s.id === "chat")!.detail).toContain("Main (m1), Preset");
  });

  it("lists chat connections and presets without keys", async () => {
    const fake = fakeFetch({
      "GET /api/connections": () => ({
        json: [
          { id: "c1", name: "Main", provider: "openai", model: "m1", isDefault: true, apiKeyEncrypted: "SECRET_KEY" },
          { id: "c2", name: "Pics", provider: "image_generation", model: "img", apiKeyEncrypted: "SECRET_KEY" },
        ],
      }),
      "GET /api/prompts": () => ({ json: [{ id: "p1", name: "Preset", isDefault: "true", sections: "SECRET_PROMPT" }, { id: "p2", name: "Other", isDefault: "false" }] }),
    });
    const c = createMarinaraClient({ baseUrl: BASE, credentials: null, fetch: fake.fetch });
    expect(await c.chatConnections()).toEqual([{ id: "c1", name: "Main", model: "m1", isDefault: true }]);
    expect(await c.presets()).toEqual([
      { id: "p1", name: "Preset", isDefault: true },
      { id: "p2", name: "Other", isDefault: false },
    ]);
  });

  it("refuses without the Narrative Director unless told to push without the Secret Plot", async () => {
    const fake = fakeMarinara({ director: false });
    await expect(pushToMarinara(client(fake), BASE, pkg(), {}, opts)).rejects.toThrow(PushRefusedError);
    expect(fake.requests.some((r) => r.method === "POST")).toBe(false);

    const record = await pushToMarinara(client(fake), BASE, pkg(), {}, { ...opts, withoutSecretPlot: true });
    expect(record.status).toBe("done");
    expect(record.secretPlot).toBe("skipped");
    expect(fake.meta.activeAgentIds).toBeUndefined();
    expect(fake.requests.some((r) => r.url.includes("/agents/memory"))).toBe(false);
  });

  it("removes everything it created when a step fails, newest first", async () => {
    const fake = fakeMarinara({ failOn: "message" });
    const record = await pushToMarinara(client(fake), BASE, pkg(), {}, opts);
    expect(record.status).toBe("failed");
    expect(record.chatId).toBeNull();
    expect(record.steps.find((s) => s.id === "opening")!.status).toBe("failed");
    expect(record.steps.find((s) => s.id === "characters")!.status).toBe("undone");
    expect(record.steps.at(-1)).toMatchObject({ id: "rollback", status: "ok", detail: "6 created resources removed" });
    expect(fake.requests.filter((r) => r.method === "DELETE").map((r) => r.url.replace(BASE, ""))).toEqual([
      "/api/chats/chat-1",
      "/api/lorebooks/imp-5",
      "/api/lorebooks/imp-4",
      "/api/characters/personas/imp-3",
      "/api/characters/imp-2",
      "/api/characters/imp-1",
    ]);
  });

  it("builds vectors when asked, and keeps the chat when vectorizing fails", async () => {
    const withVectors = () => {
      const p = pkg();
      p.lorebooks[0]!.vectors.enabled = true;
      return p;
    };
    const ok = fakeMarinara();
    const built = await pushToMarinara(client(ok), BASE, withVectors(), {}, { ...opts, vectorConnectionId: "emb-1" });
    expect(built.vectors).toEqual([{ lorebook: "Probe World", status: "built", vectorized: 3, total: 4 }]);
    expect(ok.requests.find((r) => r.url.endsWith("/vectorize"))!.body).toEqual({ connectionId: "emb-1", onlyMissing: false });

    const bad = fakeMarinara({ failOn: "vectorize" });
    const kept = await pushToMarinara(client(bad), BASE, withVectors(), {}, { ...opts, vectorConnectionId: "emb-1" });
    expect(kept.status).toBe("done");
    expect(kept.vectors[0]!.status).toBe("failed");
    expect(bad.requests.some((r) => r.method === "DELETE")).toBe(false);

    const skipped = await pushToMarinara(client(fakeMarinara()), BASE, withVectors(), {}, opts);
    expect(skipped.steps.at(-1)).toMatchObject({ id: "vectors", status: "skipped" });
  });

  it("never repeats the password in errors", async () => {
    const fake = fakeFetch({ "GET /api/capability-packages/installed": () => ({ status: 401, text: "Unauthorized" }) });
    const c = createMarinaraClient({ baseUrl: BASE, credentials: { username: "u", password: "pass-word-123" }, fetch: fake.fetch });
    const error = await pushToMarinara(c, BASE, pkg(), {}, opts).catch((e: Error) => e);
    expect(String(error)).toMatch(/401.*Check the Marinara login/);
    expect(String(error)).not.toContain("pass-word-123");
  });
});
