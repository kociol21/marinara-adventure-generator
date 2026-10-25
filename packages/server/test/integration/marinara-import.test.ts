/**
 * Differential test against a real, throwaway Marinara instance (never a live install):
 *   node tools/marinara-test/start.mjs            # local staging clone on :7870
 *   MARINARA_TEST_URL=http://127.0.0.1:7870 pnpm --filter @adv/server test:marinara
 * It imports the exported probe package through Marinara's own import route, checks the
 * stored fields, then compares Marinara's activation test with our simulator for every
 * probe scenario. Everything it creates is deleted afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toNative } from "../../src/marinara/native.ts";
import { simulateActivation } from "../../src/marinara/simulate.ts";
import { probePackage, probeScenarios } from "../fixtures/probe-package.ts";

const base = process.env.MARINARA_TEST_URL;
async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  // Fastify rejects a JSON content type with an empty body, so DELETE goes without it.
  const headers: Record<string, string> = { "x-marinara-csrf": "1", ...(body === undefined ? {} : { "Content-Type": "application/json" }) };
  const res = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : null) as T;
}

const created = { characters: [] as string[], personas: [] as string[], lorebooks: [] as string[], chats: [] as string[] };
const cardIds = new Map<string, string>();
const lorebookIds = new Map<string, string>();

describe.skipIf(!base)("Marinara import (differential)", () => {
  beforeAll(async () => {
    const native = toNative(probePackage);
    for (const { card, envelope } of native.characters) {
      const r = await api("POST", "/api/import/marinara", envelope);
      expect(r.success, JSON.stringify(r)).toBe(true);
      cardIds.set(card.key, r.id);
      created.characters.push(r.id);
    }
    if (native.persona) {
      const r = await api("POST", "/api/import/marinara", native.persona);
      expect(r.success).toBe(true);
      created.personas.push(r.id);
    }
    for (const { lorebook, envelope } of native.lorebooks) {
      const r = await api("POST", "/api/import/marinara", envelope);
      expect(r.success).toBe(true);
      lorebookIds.set(lorebook.key, r.id);
      created.lorebooks.push(r.id);
    }
  });

  afterAll(async () => {
    const failed: string[] = [];
    const del = (path: string) => api("DELETE", path).catch(() => failed.push(path));
    for (const id of created.chats) await del(`/api/chats/${id}`);
    for (const id of created.lorebooks) await del(`/api/lorebooks/${id}`);
    for (const id of created.characters) await del(`/api/characters/${id}`);
    for (const id of created.personas) await del(`/api/characters/personas/${id}`);
    if (failed.length) throw new Error(`Cleanup failed for: ${failed.join(", ")}`);
  });

  it("stores every card field where Marinara reads it", async () => {
    for (const card of probePackage.characters) {
      const stored = await api("GET", `/api/characters/${cardIds.get(card.key)}`);
      const data = typeof stored.data === "string" ? JSON.parse(stored.data) : stored.data;
      expect(data).toMatchObject({
        name: card.name,
        description: card.description,
        personality: card.personality,
        scenario: card.scenario,
        first_mes: card.firstMessage,
        mes_example: card.exampleDialogue,
        extensions: { backstory: card.backstory, appearance: card.appearance },
      });
    }
  });

  it("keeps lorebook settings and leaves no foreign ids", async () => {
    for (const lb of probePackage.lorebooks) {
      const id = lorebookIds.get(lb.key)!;
      const stored = await api("GET", `/api/lorebooks/${id}`);
      expect(stored).toMatchObject({
        name: lb.name,
        scanDepth: lb.scanDepth,
        tokenBudget: lb.tokenBudget,
        recursiveScanning: lb.recursiveScanning,
        isGlobal: false,
        characterIds: [],
      });
      const entries: any[] = await api("GET", `/api/lorebooks/${id}/entries`);
      expect(entries).toHaveLength(lb.entries.length);
      for (const draft of lb.entries) {
        const e = entries.find((x) => x.name === draft.name);
        expect(e, draft.name).toBeDefined();
        expect(e.characterFilterIds).toEqual([]);
        expect(e.constant).toBe(draft.type === "constant");
        expect(e.selective).toBe(draft.type === "selective");
        expect(e.keys).toEqual(draft.keys);
      }
    }
  });

  for (const scenario of probeScenarios) {
    it(`activates the same entries as the simulator: ${scenario.name}`, async () => {
      const chat = await api("POST", "/api/chats", {
        name: `probe: ${scenario.name}`,
        mode: "roleplay",
        characterIds: scenario.cards.map((k) => cardIds.get(k)),
      });
      created.chats.push(chat.id);
      for (const content of scenario.messages) {
        await api("POST", `/api/chats/${chat.id}/messages`, { chatId: chat.id, role: "user", characterId: null, content });
      }

      const sim = simulateActivation(
        probePackage,
        scenario.messages.map((content) => ({ role: "user" as const, content })),
        { activeCardKeys: scenario.cards },
      );
      for (const lb of probePackage.lorebooks) {
        const marinara = await api("POST", `/api/lorebooks/${lorebookIds.get(lb.key)}/test`, { chatId: chat.id });
        const actual = (marinara.activated as Array<{ name: string }>).map((e) => e.name).sort();
        const nameOf = new Map(lb.entries.map((e) => [e.key, e.name]));
        const expected = sim.entries
          .filter((e) => e.lorebookKey === lb.key && e.status === "activated")
          .map((e) => nameOf.get(e.entryKey)!)
          .sort();
        if (process.env.MARINARA_TEST_VERBOSE) console.log(`${scenario.name} | ${lb.name}: ${actual.join(", ") || "-"}`);
        expect(actual, `${lb.name}`).toEqual(expected);
      }
    });
  }
});
