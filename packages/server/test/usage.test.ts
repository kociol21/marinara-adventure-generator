import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { openDatabase, type Db } from "../src/db/database.ts";
import { MemorySecretStore } from "../src/secrets/secret-store.ts";
import { usageOf } from "../src/connections/adapters.ts";
import { stageOf } from "../src/repos/usage.ts";
import { fakeFetch } from "./fake-fetch.ts";

const PORT = 7880;
const host = `127.0.0.1:${PORT}`;
const write = { host, "x-adv-csrf": "1", "content-type": "application/json" };

let app: FastifyInstance;
let db: Db;

afterEach(async () => {
  await app?.close();
  db?.close();
});

const reply = JSON.stringify({
  message: "Got it.",
  questions: ["Gritty or playful?"],
  requirements: { idea: "A case" },
  assumptions: [],
  readyForSummary: false,
});

/** NanoGPT with one model; the catalog entry and the chat usage block are up to the test. */
async function setup(model: Record<string, unknown>, usage: Record<string, unknown> | null) {
  const fake = fakeFetch({
    "GET /models": () => ({ json: { data: [{ id: "m1", name: "M1", ...model }] } }),
    "POST /chat/completions": () => ({ json: { choices: [{ message: { content: reply } }], ...(usage ? { usage } : {}) } }),
  });
  db = openDatabase(":memory:");
  app = await buildApp({ db, secretStore: new MemorySecretStore(), dataDir: "x", port: PORT, fetch: fake.fetch });
  const conn = (await app.inject({ method: "POST", url: "/api/connections", headers: write, payload: { kind: "nano-gpt", name: "N", apiKey: "k" } })).json();
  await app.inject({ method: "POST", url: `/api/connections/${conn.id}/models/fetch`, headers: write, payload: { capability: "text" } });
  await app.inject({ method: "PUT", url: "/api/assignments/text", headers: write, payload: { connectionId: conn.id, modelId: "m1" } });
  const id = (await app.inject({ method: "POST", url: "/api/projects", headers: write, payload: { title: "Case" } })).json().id as string;
  const res = await app.inject({ method: "POST", url: `/api/projects/${id}/interview/messages`, headers: write, payload: { content: "Noir, please." } });
  expect(res.statusCode).toBe(200);
  return { id, connectionId: conn.id as string };
}

const paid = { pricing: { prompt: 2, completion: 10, currency: "USD", unit: "per_million_tokens" }, subscription: { included: false } };
const included = { pricing: { prompt: 0.5, completion: 1, currency: "USD", unit: "per_million_tokens" }, subscription: { included: true, inputTokenMultiplier: 0.5 } };

describe("usage helpers", () => {
  it("reads OpenAI-style usage blocks", () => {
    expect(usageOf({ usage: { prompt_tokens: 10, completion_tokens: 4, cost: 0.002 } })).toEqual({ inputTokens: 10, outputTokens: 4, costUsd: 0.002 });
    expect(usageOf({ usage: { input_tokens: 7, output_tokens: 3 } })).toEqual({ inputTokens: 7, outputTokens: 3, costUsd: null });
    expect(usageOf({ choices: [] })).toBeNull();
  });

  it("groups purposes by stage", () => {
    expect(stageOf("lorebook:plot")).toBe("lorebook");
    expect(stageOf("avatar:someone:check")).toBe("avatar");
    expect(stageOf("audit-spoilers")).toBe("audit");
    expect(stageOf("plan")).toBe("plan");
  });
});

describe("usage per adventure", () => {
  it("prices reported tokens at the model's list price", async () => {
    const { id } = await setup(paid, { prompt_tokens: 1000, completion_tokens: 500 });
    const usage = (await app.inject({ method: "GET", url: `/api/projects/${id}/usage`, headers: { host } })).json();
    expect(usage.total).toMatchObject({ requests: 1, failed: 0, inputTokens: 1000, outputTokens: 500, unpricedCalls: 0, estimated: false });
    expect(usage.total.costUsd).toBeCloseTo(0.007, 10);
    expect(usage.stages).toEqual([expect.objectContaining({ stage: "interview", requests: 1 })]);
  });

  it("prefers the cost the provider reported", async () => {
    const { id } = await setup(paid, { prompt_tokens: 1000, completion_tokens: 500, cost: 0.05 });
    const usage = (await app.inject({ method: "GET", url: `/api/projects/${id}/usage`, headers: { host } })).json();
    expect(usage.total.costUsd).toBeCloseTo(0.05, 10);
  });

  it("counts subscription quota instead of money", async () => {
    const { id } = await setup(included, { prompt_tokens: 1000, completion_tokens: 500 });
    const usage = (await app.inject({ method: "GET", url: `/api/projects/${id}/usage`, headers: { host } })).json();
    expect(usage.total).toMatchObject({ costUsd: 0, quotaTokens: 500, unpricedCalls: 0 });
  });

  it("estimates tokens when the provider reports none", async () => {
    const { id } = await setup(paid, null);
    const usage = (await app.inject({ method: "GET", url: `/api/projects/${id}/usage`, headers: { host } })).json();
    expect(usage.total.estimated).toBe(true);
    expect(usage.total.inputTokens).toBeGreaterThan(0);
    expect(usage.total.outputTokens).toBe(Math.ceil(reply.length / 4));
  });

  it("answers 404 for an unknown adventure", async () => {
    await setup(paid, null);
    expect((await app.inject({ method: "GET", url: "/api/projects/nope/usage", headers: { host } })).statusCode).toBe(404);
  });
});

describe("usage forecast", () => {
  const insert = (projectId: string, task: string, purpose: string, input: number | null, output: number | null) =>
    db
      .prepare(
        `INSERT INTO llm_call (project_id, task, purpose, connection_id, model_id, ok, latency_ms, error, created_at, input_tokens, output_tokens)
         VALUES (?, ?, ?, 'c', 'm1', 1, 1, NULL, '2026-01-01', ?, ?)`,
      )
      .run(projectId, task, purpose, input, output);

  it("has nothing to say before an adventure is finished", async () => {
    await setup(paid, null);
    const e = (await app.inject({ method: "GET", url: "/api/usage/estimate", headers: { host } })).json();
    expect(e).toMatchObject({ basedOn: 0, costUsd: null, model: "m1", billing: "paid" });
  });

  it("averages finished adventures, leaves out the interview, and prices at the current model", async () => {
    const { id } = await setup(paid, { prompt_tokens: 1000, completion_tokens: 500 });
    db.prepare("UPDATE project SET status = 'ready' WHERE id = ?").run(id);
    // One finished run: 4 text requests (two measured, two from before tracking) and 2 images.
    insert(id, "text", "plan", 10_000, 2_000);
    insert(id, "text", "lorebook:world", 30_000, 6_000);
    insert(id, "text", "facts", null, null);
    insert(id, "text", "audit-review", null, null);
    insert(id, "image", "avatar:x", null, null);
    insert(id, "image", "avatar:y", null, null);
    const e = (await app.inject({ method: "GET", url: "/api/usage/estimate", headers: { host } })).json();
    expect(e).toMatchObject({ basedOn: 1, requests: 6, images: 2, inputTokens: 80_000, outputTokens: 16_000, quotaTokens: null });
    expect(e.costUsd).toBeCloseTo((80_000 * 2 + 16_000 * 10) / 1e6, 10);
    // The adventure being started does not forecast itself.
    const self = (await app.inject({ method: "GET", url: `/api/usage/estimate?exclude=${id}`, headers: { host } })).json();
    expect(self.basedOn).toBe(0);
  });
});

describe("story model", () => {
  it("sends plan, clues and opening to the story model when one is assigned, and prices the forecast per model", async () => {
    const fake = fakeFetch({
      "GET /models": () => ({
        json: {
          data: [
            { id: "cheap", name: "Cheap", ...paid },
            { id: "strong", name: "Strong", pricing: { prompt: 20, completion: 100, currency: "USD", unit: "per_million_tokens" }, subscription: { included: false } },
          ],
        },
      }),
      "POST /chat/completions": () => ({ json: { choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 10, completion_tokens: 5 } } }),
    });
    db = openDatabase(":memory:");
    const store = new MemorySecretStore();
    app = await buildApp({ db, secretStore: store, dataDir: "x", port: PORT, fetch: fake.fetch });
    const conn = (await app.inject({ method: "POST", url: "/api/connections", headers: write, payload: { kind: "nano-gpt", name: "N", apiKey: "k" } })).json();
    await app.inject({ method: "POST", url: `/api/connections/${conn.id}/models/fetch`, headers: write, payload: { capability: "text" } });
    await app.inject({ method: "PUT", url: "/api/assignments/text", headers: write, payload: { connectionId: conn.id, modelId: "cheap" } });
    const id = (await app.inject({ method: "POST", url: "/api/projects", headers: write, payload: { title: "Case" } })).json().id as string;
    const { createTextGenerator } = await import("../src/generation/text.ts");
    const { createConnectionsRepo } = await import("../src/repos/connections.ts");
    const { createSecretsRepo } = await import("../src/repos/secrets.ts");
    const text = createTextGenerator(db, createConnectionsRepo(db, createSecretsRepo(db, store)), { fetch: fake.fetch } as never);
    const modelOf = async (purpose: string) => {
      await text.generate({ projectId: id, purpose, system: "s", messages: [{ role: "user", content: "u" }] });
      return (fake.requests.at(-1)!.body as { model: string }).model;
    };

    // Without a story model everything goes to the text model.
    expect(await modelOf("plan")).toBe("cheap");
    const put = await app.inject({ method: "PUT", url: "/api/assignments/story", headers: write, payload: { connectionId: conn.id, modelId: "strong" } });
    expect(put.statusCode).toBe(200);
    expect(await modelOf("plan")).toBe("strong");
    expect(await modelOf("clues")).toBe("strong");
    expect(await modelOf("opening")).toBe("strong");
    expect(await modelOf("facts")).toBe("cheap");
    expect(await modelOf("lorebook:plot")).toBe("cheap");
    expect(await modelOf("audit-review")).toBe("cheap");
    const tasks = db.prepare("SELECT task, purpose FROM llm_call ORDER BY id").all() as Array<{ task: string; purpose: string }>;
    expect(tasks.filter((t) => t.task === "story").map((t) => t.purpose)).toEqual(["plan", "clues", "opening"]);
    // Story calls are priced at the strong model's list price.
    const usage = (await app.inject({ method: "GET", url: `/api/projects/${id}/usage`, headers: { host } })).json();
    expect(usage.total.costUsd).toBeCloseTo((4 * (10 * 2 + 5 * 10) + 3 * (10 * 20 + 5 * 100)) / 1e6, 12);

    db.prepare("UPDATE project SET status = 'ready' WHERE id = ?").run(id);
    const e = (await app.inject({ method: "GET", url: "/api/usage/estimate", headers: { host } })).json();
    expect(e).toMatchObject({ basedOn: 1, model: "cheap", storyModel: "strong", inputTokens: 70, outputTokens: 35 });
    // The forecast prices by stage at the models assigned now, so the first plan call counts as story too.
    expect(e.costUsd).toBeCloseTo((30 * 2 + 15 * 10 + 40 * 20 + 20 * 100) / 1e6, 12);

    // Clearing it sends the story stages back to the text model.
    await app.inject({ method: "DELETE", url: "/api/assignments/story", headers: { host, "x-adv-csrf": "1" } });
    expect(await modelOf("plan")).toBe("cheap");
  });
});
