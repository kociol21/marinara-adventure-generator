import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { openDatabase, type Db } from "../src/db/database.ts";
import { MemorySecretStore } from "../src/secrets/secret-store.ts";
import type { CodexAuthClient } from "../src/connections/codex-auth.ts";
import { fakeFetch, type RecordedRequest } from "./fake-fetch.ts";

const PORT = 7880;
const host = `127.0.0.1:${PORT}`;
const write = { host, "x-adv-csrf": "1", "content-type": "application/json" };

let app: FastifyInstance;
let db: Db;

const codexAuth: CodexAuthClient = {
  path: "test-auth.json",
  get: async () => ({ accessToken: "codex-token", accountId: "acct-1", planType: "plus" }),
  status: async () => ({
    authFile: "test-auth.json",
    loggedIn: true,
    planType: "plus",
    accessTokenExpiresAt: null,
    hasRefreshToken: true,
    lastRefresh: null,
    problem: null,
  }),
};

async function setup(routes: Parameters<typeof fakeFetch>[0]) {
  const fake = fakeFetch(routes);
  db = openDatabase(":memory:");
  const store = new MemorySecretStore();
  app = await buildApp({ db, secretStore: store, dataDir: "x", port: PORT, fetch: fake.fetch, codexAuth });
  return { ...fake, store };
}

afterEach(async () => {
  await app?.close();
  db?.close();
});

async function create(body: Record<string, unknown>) {
  const res = await app.inject({ method: "POST", url: "/api/connections", headers: write, payload: body });
  expect(res.statusCode).toBe(201);
  return res.json();
}

const post = (url: string, payload: unknown) => app.inject({ method: "POST", url, headers: write, payload: payload as object });

describe("connections", () => {
  it("keeps API keys in the secret store and never returns them", async () => {
    const { store } = await setup({});
    const conn = await create({ kind: "nano-gpt", name: "Nano", apiKey: "sk-secret-123456" });
    expect(conn.hasApiKey).toBe(true);
    expect(conn.baseUrl).toBe("https://nano-gpt.com/api/v1");
    expect(JSON.stringify(conn)).not.toContain("sk-secret");
    expect(store.get(`connection:${conn.id}:api-key`)).toBe("sk-secret-123456");

    const list = await app.inject({ method: "GET", url: "/api/connections", headers: { host } });
    expect(list.body).not.toContain("sk-secret");

    await app.inject({ method: "DELETE", url: `/api/connections/${conn.id}`, headers: { host, "x-adv-csrf": "1" } });
    expect(store.get(`connection:${conn.id}:api-key`)).toBeNull();
  });

  it("pins the Codex address and requires a base URL for generic endpoints", async () => {
    await setup({});
    const codex = await create({ kind: "codex-chatgpt", name: "ChatGPT", baseUrl: "https://evil.example/v1" });
    expect(codex.baseUrl).toBe("https://chatgpt.com/backend-api/codex");
    const res = await post("/api/connections", { kind: "openai-compatible", name: "Custom" });
    expect(res.statusCode).toBe(400);
  });
});

describe("model catalogs", () => {
  it("fetches NanoGPT text and image lists separately and reads subscription coverage", async () => {
    const { requests } = await setup({
      "GET nano-gpt.com/api/v1/models?detailed=true": () => ({
        json: {
          data: [
            { id: "glm-5", name: "GLM 5", context_length: 200000, subscription: { included: true, inputTokenMultiplier: 1 } },
            { id: "big-model", name: "Big", subscription: { included: false, inputTokenMultiplier: 1 } },
            { id: "plain" },
          ],
        },
      }),
      "GET nano-gpt.com/api/v1/image-models": () => ({ json: { data: [{ id: "flux-dev", name: "Flux Dev" }] } }),
    });
    const conn = await create({ kind: "nano-gpt", name: "Nano", apiKey: "k" });

    const text = await post(`/api/connections/${conn.id}/models/fetch`, { capability: "text" });
    expect(text.statusCode).toBe(200);
    const byId = Object.fromEntries(text.json().models.map((m: { modelId: string }) => [m.modelId, m]));
    expect(byId["glm-5"]).toMatchObject({ billing: "subscription", quotaMultiplier: 1, contextLength: 200000 });
    expect(byId["big-model"]).toMatchObject({ billing: "paid", quotaMultiplier: null });
    expect(byId["plain"]).toMatchObject({ billing: "unknown" });
    expect(requests).toHaveLength(1);

    const image = await post(`/api/connections/${conn.id}/models/fetch`, { capability: "image" });
    expect(image.json().models.map((m: { modelId: string }) => m.modelId)).toEqual(["flux-dev"]);
    expect(requests).toHaveLength(2);
    expect(requests.every((r: RecordedRequest) => r.method === "GET" && r.headers.authorization === "Bearer k")).toBe(true);
  });

  it("keeps manually added models across a re-fetch and refuses unsupported capabilities", async () => {
    await setup({ "GET nano-gpt.com/api/v1/models?detailed=true": () => ({ json: { data: [{ id: "a" }] } }) });
    const conn = await create({ kind: "nano-gpt", name: "Nano", apiKey: "k" });
    await post(`/api/connections/${conn.id}/models`, { capability: "text", modelId: "my-custom" });
    const res = await post(`/api/connections/${conn.id}/models/fetch`, { capability: "text" });
    const ids = res.json().models.map((m: { modelId: string; source: string }) => `${m.modelId}:${m.source}`);
    expect(ids).toEqual(["a:catalog", "my-custom:manual"]);

    const emb = await post(`/api/connections/${conn.id}/models/fetch`, { capability: "embedding" });
    expect(emb.statusCode).toBe(400);
    expect(emb.json().error).toMatch(/manually/);
  });

  it("lists Codex text models from the ChatGPT catalog and offers gpt-image-2 for images", async () => {
    const { requests } = await setup({
      "GET chatgpt.com/backend-api/codex/models": () => ({
        json: {
          models: [
            { slug: "gpt-5.5", display_name: "GPT-5.5", visibility: "list", context_window: 272000 },
            { slug: "codex-auto-review", display_name: "Codex Auto Review", visibility: "hide" },
          ],
        },
      }),
    });
    const conn = await create({ kind: "codex-chatgpt", name: "ChatGPT" });
    const text = await post(`/api/connections/${conn.id}/models/fetch`, { capability: "text" });
    expect(text.json().models).toHaveLength(1);
    expect(text.json().models[0]).toMatchObject({ modelId: "gpt-5.5", billing: "subscription", contextLength: 272000 });
    // An old client_version makes the catalog come back empty.
    expect(requests[0]!.url).toContain("client_version=1.0.0");
    expect(requests[0]!.headers).toMatchObject({ authorization: "Bearer codex-token", "chatgpt-account-id": "acct-1" });

    const image = await post(`/api/connections/${conn.id}/models/fetch`, { capability: "image" });
    expect(image.json().models[0]).toMatchObject({ modelId: "gpt-image-2", source: "builtin" });
    expect(requests).toHaveLength(1);

    const emb = await post(`/api/connections/${conn.id}/models/fetch`, { capability: "embedding" });
    expect(emb.statusCode).toBe(400);
  });

  it("reports provider errors without leaking the key", async () => {
    await setup({
      "GET nano-gpt.com/api/v1/models": () => ({ status: 401, json: { error: "bad key sk-secret-abcdefgh" } }),
    });
    const conn = await create({ kind: "nano-gpt", name: "Nano", apiKey: "sk-secret-abcdefgh" });
    const res = await post(`/api/connections/${conn.id}/models/fetch`, { capability: "text" });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toContain("401");
    expect(res.body).not.toContain("sk-secret");
  });
});

describe("tests", () => {
  it("refuses to test without explicit usage confirmation", async () => {
    const { requests } = await setup({});
    const conn = await create({ kind: "nano-gpt", name: "Nano", apiKey: "k" });
    const res = await post(`/api/connections/${conn.id}/test-text`, { modelId: "x" });
    expect(res.statusCode).toBe(400);
    expect(requests).toHaveLength(0);
  });

  it("tests text through Chat Completions", async () => {
    const { requests } = await setup({
      "POST /chat/completions": () => ({ json: { choices: [{ message: { content: "ready" } }] } }),
    });
    const conn = await create({ kind: "nano-gpt", name: "Nano", apiKey: "k" });
    const res = await post(`/api/connections/${conn.id}/test-text`, { modelId: "glm-5", confirmUsage: true });
    expect(res.json()).toMatchObject({ ok: true, reply: "ready", modelId: "glm-5" });
    expect(requests[0]!.body).toMatchObject({ model: "glm-5", stream: false });
  });

  it("tests Codex text through the streaming Responses API", async () => {
    const sse = [
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "rea" })}`,
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "dy" })}`,
      `data: ${JSON.stringify({ type: "response.completed", response: { output: [] } })}`,
      "",
    ].join("\n\n");
    const { requests } = await setup({
      "POST chatgpt.com/backend-api/codex/responses": () => ({ text: sse, headers: { "content-type": "text/event-stream" } }),
    });
    const conn = await create({ kind: "codex-chatgpt", name: "ChatGPT" });
    const res = await post(`/api/connections/${conn.id}/test-text`, { modelId: "gpt-5.5", confirmUsage: true });
    expect(res.json()).toMatchObject({ ok: true, reply: "ready" });
    expect(requests[0]!.body).toMatchObject({ model: "gpt-5.5", stream: true, store: false });
    expect(requests[0]!.body).not.toHaveProperty("temperature");
  });

  it("tests NanoGPT images on the /v1 image endpoint", async () => {
    const { requests } = await setup({
      "POST nano-gpt.com/v1/images/generations": () => ({ json: { data: [{ b64_json: "aGVsbG8=" }] } }),
    });
    const conn = await create({ kind: "nano-gpt", name: "Nano", apiKey: "k" });
    const res = await post(`/api/connections/${conn.id}/test-image`, { modelId: "flux-dev", confirmUsage: true });
    expect(res.json()).toMatchObject({ ok: true, imageDataUrl: "data:image/png;base64,aGVsbG8=" });
    expect(requests[0]!.url).toBe("https://nano-gpt.com/v1/images/generations");
  });

  it("lists Nano's decision models from its catalog, with subscription coverage", async () => {
    await setup({
      "GET nano-gpt.com/api/v1/models?detailed=true": () => ({
        json: { data: [{ id: "glm-5" }, { id: "typesafe/jev-1.14", name: "TypeSafe Jev 1.14", subscription: { included: true, inputTokenMultiplier: 1 } }] },
      }),
    });
    const conn = await create({ kind: "nano-gpt", name: "Nano", apiKey: "k" });
    const res = await post(`/api/connections/${conn.id}/models/fetch`, { capability: "decision" });
    expect(res.json().models).toEqual([expect.objectContaining({ modelId: "typesafe/jev-1.14", billing: "subscription" })]);
  });

  it("tests a decision model on the Decisions API and refuses it on Codex", async () => {
    const { requests } = await setup({
      "POST nano-gpt.com/api/v1/decisions": () => ({ json: { answers: { refund: { type: "noul", noul: 0.97 } } } }),
    });
    const conn = await create({ kind: "nano-gpt", name: "Nano", apiKey: "k" });
    const res = await post(`/api/connections/${conn.id}/test-decision`, { modelId: "typesafe/jev-1.14", confirmUsage: true });
    expect(res.json()).toMatchObject({ ok: true, reply: "yes with p = 0.97" });
    expect(requests[0]!.url).toBe("https://nano-gpt.com/api/v1/decisions");
    expect(requests[0]!.body).toMatchObject({ model: "typesafe/jev-1.14", questions: { refund: { type: "noul" } } });
    const codex = await create({ kind: "codex-chatgpt", name: "ChatGPT" });
    expect((await post(`/api/connections/${codex.id}/test-decision`, { modelId: "x", confirmUsage: true })).statusCode).toBe(400);
  });

  it("returns a failed result instead of throwing when the provider errors", async () => {
    await setup({ "POST /chat/completions": () => ({ status: 429, json: { error: "rate limited" } }) });
    const conn = await create({ kind: "nano-gpt", name: "Nano", apiKey: "k" });
    const res = await post(`/api/connections/${conn.id}/test-text`, { modelId: "m", confirmUsage: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: false });
    expect(res.json().error).toContain("429");
  });
});

describe("assignments", () => {
  it("assigns tasks only to known models on capable connections", async () => {
    await setup({ "GET nano-gpt.com/api/v1/models?detailed=true": () => ({ json: { data: [{ id: "glm-5" }] } }) });
    const nano = await create({ kind: "nano-gpt", name: "Nano", apiKey: "k" });
    const codex = await create({ kind: "codex-chatgpt", name: "ChatGPT" });

    const unknown = await app.inject({ method: "PUT", url: "/api/assignments/text", headers: write, payload: { connectionId: nano.id, modelId: "glm-5" } });
    expect(unknown.statusCode).toBe(400);

    await post(`/api/connections/${nano.id}/models/fetch`, { capability: "text" });
    const ok = await app.inject({ method: "PUT", url: "/api/assignments/text", headers: write, payload: { connectionId: nano.id, modelId: "glm-5" } });
    expect(ok.statusCode).toBe(200);

    const noEmbeddings = await app.inject({
      method: "PUT",
      url: "/api/assignments/embedding",
      headers: write,
      payload: { connectionId: codex.id, modelId: "x" },
    });
    expect(noEmbeddings.statusCode).toBe(400);

    await app.inject({ method: "DELETE", url: `/api/connections/${nano.id}`, headers: { host, "x-adv-csrf": "1" } });
    const list = await app.inject({ method: "GET", url: "/api/assignments", headers: { host } });
    expect(list.json()).toEqual([]);
  });
});
