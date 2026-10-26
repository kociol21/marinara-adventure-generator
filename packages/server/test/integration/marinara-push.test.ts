/**
 * Push to Marinara against a real, throwaway Marinara instance (never a live install):
 *   node tools/marinara-test/start.mjs            # local staging clone on :7870, Director installed
 *   MARINARA_TEST_URL=http://127.0.0.1:7870 pnpm --filter @adv/server test:marinara
 * The neutral pipeline fixture is generated through a fake model, pushed through the app's route,
 * then read back from Marinara: chat, attached lorebooks, opening message and Secret Plot memory.
 * Everything the push created is deleted afterwards.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { requirementsSchema, type PushRecord } from "@adv/shared";
import { buildApp } from "../../src/app.ts";
import { openDatabase } from "../../src/db/database.ts";
import { MemorySecretStore } from "../../src/secrets/secret-store.ts";
import type { Pipeline } from "../../src/pipeline/runner.ts";
import type { FetchFn } from "../../src/connections/http.ts";
import fixture from "../../../../tools/marinara-test/pipeline-fixture.json" with { type: "json" };

const base = process.env.MARINARA_TEST_URL;
const PORT = 7880;
const host = `127.0.0.1:${PORT}`;
const write = { host, "x-adv-csrf": "1", "content-type": "application/json" };

async function marinara<T = any>(method: string, path: string): Promise<T> {
  const res = await fetch(`${base}${path}`, { method, headers: { "x-marinara-csrf": "1" } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : null) as T;
}

/** The fake model serves the neutral fixture; everything else goes to the real network (Marinara). */
const fetchFn: FetchFn = async (input, init) => {
  const url = String(input);
  if (!url.includes("fake-llm.invalid")) return fetch(input, init);
  if (url.endsWith("/models")) return Response.json({ data: [{ id: "m1" }] });
  const system = (JSON.parse(String(init!.body)) as { messages: Array<{ content: string }> }).messages[0]!.content;
  const stage = system.match(/^Stage: ([\w-]+)/m)?.[1] ?? "?";
  const sub = system.match(/^Card key: (\S+)/m)?.[1] ?? system.match(/^Lorebook: (\w+)/m)?.[1] ?? null;
  const f = fixture as Record<string, any>;
  const content = JSON.stringify(stage === "card" ? f.cards[sub!] : stage === "lorebook" ? f.lorebooks[sub!] : f[stage]);
  return Response.json({ choices: [{ message: { content } }] });
};

let app: FastifyInstance;
let record: PushRecord | null = null;

describe.skipIf(!base)("Push to Marinara (local instance)", () => {
  afterAll(async () => {
    // Clean up through Marinara itself, using what the chat says it holds.
    if (record?.chatId) {
      const chat = await marinara("GET", `/api/chats/${record.chatId}`);
      await marinara("DELETE", `/api/chats/${record.chatId}`);
      for (const id of chat.characterIds as string[]) await marinara("DELETE", `/api/characters/${id}`);
      if (chat.personaId) await marinara("DELETE", `/api/characters/personas/${chat.personaId}`);
      for (const id of (chat.metadata.activeLorebookIds ?? []) as string[]) await marinara("DELETE", `/api/lorebooks/${id}`);
    }
    await app?.close();
  });

  it("creates the chat with lorebooks, the opening scene and a Secret Plot the Director keeps", async () => {
    app = await buildApp({ db: openDatabase(":memory:"), secretStore: new MemorySecretStore(), dataDir: mkdtempSync(join(tmpdir(), "push-")), port: PORT, fetch: fetchFn });
    const conn = (await app.inject({ method: "POST", url: "/api/connections", headers: write, payload: { kind: "openai-compatible", name: "Fake", baseUrl: "http://fake-llm.invalid/v1", apiKey: "fake-key-123" } })).json();
    await app.inject({ method: "POST", url: `/api/connections/${conn.id}/models/fetch`, headers: write, payload: { capability: "text" } });
    await app.inject({ method: "PUT", url: "/api/assignments/text", headers: write, payload: { connectionId: conn.id, modelId: "m1" } });
    await app.inject({ method: "PATCH", url: "/api/settings", headers: write, payload: { marinaraBaseUrl: base } });
    const id = (await app.inject({ method: "POST", url: "/api/projects", headers: write, payload: { title: "Push Probe" } })).json().id as string;
    const requirements = requirementsSchema.parse({ idea: "Neutral.", genre: "mystery", tone: ["neutral"], setting: { era: "probe era", place: "probe city" }, startingSituation: "A probe begins.", maxNpcCards: 3 });
    await app.inject({ method: "PUT", url: `/api/projects/${id}/requirements`, headers: write, payload: { requirements } });
    await app.inject({ method: "POST", url: `/api/projects/${id}/requirements/approve`, headers: write, payload: {} });
    await app.inject({ method: "POST", url: `/api/projects/${id}/generation/start`, headers: write, payload: { confirmUsage: true } });
    await (app as unknown as { pipeline: Pipeline }).pipeline.idle(id);

    const status = (await app.inject({ method: "GET", url: "/api/marinara/status", headers: { host } })).json();
    expect(status).toMatchObject({ reachable: true, authenticated: true, directorInstalled: true });

    // Lists come from Marinara with names only; pick its default preset and a chat connection if it has one.
    expect(JSON.stringify(status)).not.toMatch(/apiKey/i);
    const preset = status.presets.find((p: { isDefault: boolean }) => p.isDefault) ?? status.presets[0] ?? null;
    const connection = status.chatConnections[0] ?? null;
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${id}/marinara/push`,
      headers: write,
      payload: { confirm: true, connectionId: connection?.id ?? null, promptPresetId: preset?.id ?? null },
    });
    expect(res.statusCode, res.body).toBe(200);
    record = res.json() as PushRecord;
    expect(record.status, JSON.stringify(record.steps)).toBe("done");
    expect(record.secretPlot).toBe("seeded");
    expect(record.steps.find((s) => s.id === "verify")!.status).toBe("ok");

    // Read back from Marinara directly.
    const chat = await marinara("GET", `/api/chats/${record.chatId}`);
    expect(chat.mode).toBe("roleplay");
    expect(chat.promptPresetId ?? null).toBe(preset?.id ?? null);
    expect(chat.connectionId ?? null).toBe(connection?.id ?? null);
    expect(chat.metadata).toMatchObject({ enableAgents: true, activeAgentIds: ["director"], narrativeDirectorSecretPlotEnabled: true });
    expect(chat.metadata.activeLorebookIds).toHaveLength(Object.keys((fixture as any).lorebooks).length);
    const messages = await marinara<any[]>("GET", `/api/chats/${record.chatId}/messages`);
    expect(messages.filter((m) => m.role === "assistant")).toHaveLength(1);
    expect(messages[0].content).toBe((fixture as any).opening.openingMessage);
    const memory = (await marinara("GET", `/api/agents/memory/director/${record.chatId}`)).memory;
    expect(memory.overarchingArc.description).toBe((fixture as any).opening.secretPlot.description);
    expect(memory.secretPlotLastAssistantMessageId).toBe(messages[0].id);

    // The record and the history carry no story text.
    const history = JSON.stringify((await app.inject({ method: "GET", url: `/api/projects/${id}/marinara/pushes`, headers: { host } })).json());
    expect(history).not.toContain((fixture as any).opening.secretPlot.description);
    expect(history).not.toContain((fixture as any).opening.openingMessage);
  });
});
