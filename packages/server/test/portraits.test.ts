import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import type { FastifyInstance } from "fastify";
import { portraitSettingsSchema, requirementsSchema, type GenerationState } from "@adv/shared";
import { buildApp } from "../src/app.ts";
import { openDatabase, type Db } from "../src/db/database.ts";
import { MemorySecretStore } from "../src/secrets/secret-store.ts";
import type { Pipeline } from "../src/pipeline/runner.ts";
import { portraitPrompt } from "../src/pipeline/portraits.ts";
import { fakeFetch, type RecordedRequest } from "./fake-fetch.ts";
import { readZip } from "./zip-reader.ts";
import fixture from "../../../tools/marinara-test/pipeline-fixture.json" with { type: "json" };

const PORT = 7880;
const host = `127.0.0.1:${PORT}`;
const write = { host, "x-adv-csrf": "1", "content-type": "application/json" };
let app: FastifyInstance;
let db: Db;
let landscape: string;

const requirements = requirementsSchema.parse({
  idea: "Neutral probe pitch.",
  genre: "noir detective mystery",
  tone: ["neutral"],
  setting: { era: "probe era", place: "probe city" },
  startingSituation: "A probe begins.",
  maxNpcCards: 3,
  visualStyle: "PROBE_VISUAL_STYLE",
});

beforeAll(async () => {
  // Providers may ignore the requested size; ChatGPT returned 1536x1024 in a real test.
  const png = await sharp({ create: { width: 1536, height: 1024, channels: 3, background: { r: 90, g: 20, b: 20 } } }).png().toBuffer();
  landscape = png.toString("base64");
});

const systemOf = (r: RecordedRequest) => (r.body as { messages: Array<{ content: unknown }> }).messages[0]!.content as string;
const stageOf = (r: RecordedRequest) => {
  const system = systemOf(r);
  return {
    stage: system.match(/^Stage: ([\w-]+)/m)?.[1] ?? "?",
    sub: system.match(/^Card key: (\S+)/m)?.[1] ?? system.match(/^Lorebook: (\w+)/m)?.[1] ?? null,
  };
};

async function setup(options: { check?: (n: number) => string } = {}) {
  let checks = 0;
  const fake = fakeFetch({
    "GET /models": () => ({ json: { data: [{ id: "m1" }] } }),
    "GET /image-models": () => ({ json: { data: [{ id: "img1" }] } }),
    "POST /images/generations": () => ({ json: { data: [{ b64_json: landscape }] } }),
    "POST /chat/completions": (req) => {
      const { stage, sub } = stageOf(req);
      const f = fixture as Record<string, any>;
      const content =
        stage === "portrait-check"
          ? (options.check?.(++checks) ?? JSON.stringify({ matches: true, problems: [] }))
          : JSON.stringify(stage === "card" ? f.cards[sub!] : stage === "lorebook" ? f.lorebooks[sub!] : f[stage]);
      return { json: { choices: [{ message: { content } }] } };
    },
  });
  const dataDir = mkdtempSync(join(tmpdir(), "portraits-"));
  db = openDatabase(":memory:");
  app = await buildApp({ db, secretStore: new MemorySecretStore(), dataDir, port: PORT, fetch: fake.fetch });
  const conn = (await app.inject({ method: "POST", url: "/api/connections", headers: write, payload: { kind: "nano-gpt", name: "N", apiKey: "k" } })).json();
  for (const capability of ["text", "image"]) {
    await app.inject({ method: "POST", url: `/api/connections/${conn.id}/models/fetch`, headers: write, payload: { capability } });
  }
  await app.inject({ method: "PUT", url: "/api/assignments/text", headers: write, payload: { connectionId: conn.id, modelId: "m1" } });
  await app.inject({ method: "PUT", url: "/api/assignments/image", headers: write, payload: { connectionId: conn.id, modelId: "img1" } });
  const id = (await app.inject({ method: "POST", url: "/api/projects", headers: write, payload: { title: "Probe Case" } })).json().id as string;
  await app.inject({ method: "PUT", url: `/api/projects/${id}/requirements`, headers: write, payload: { requirements } });
  await app.inject({ method: "POST", url: `/api/projects/${id}/requirements/approve`, headers: write, payload: {} });
  const images = () => fake.requests.filter((r) => r.url.includes("/images/generations"));
  const chats = () => fake.requests.filter((r) => r.url.includes("chat/completions"));
  return { id, dataDir, images, chats };
}

async function run(id: string): Promise<GenerationState> {
  await app.inject({ method: "POST", url: `/api/projects/${id}/generation/start`, headers: write, payload: { confirmUsage: true } });
  await (app as unknown as { pipeline: Pipeline }).pipeline.idle(id);
  return (await app.inject({ method: "GET", url: `/api/projects/${id}/generation`, headers: { host } })).json();
}

afterEach(async () => {
  await app?.close();
  db?.close();
});

describe("portrait prompt", () => {
  const settings = portraitSettingsSchema.parse({});
  it("is built from the character's fields, preferring image tags, in the chosen style", () => {
    const auto = portraitPrompt(requirements, settings, { name: "Mara", appearance: "tall, grey coat", imageAppearance: "red hair, freckles" });
    expect(auto).toContain("red hair, freckles");
    expect(auto).not.toContain("grey coat");
    expect(auto).toContain("PROBE_VISUAL_STYLE");
    expect(auto).toMatch(/no blood, wounds, weapons in use or props that hint at hidden events/);
    const anime = portraitPrompt(requirements, { ...settings, style: "anime", notes: "rain" }, { name: "Mara", appearance: "tall, grey coat" });
    expect(anime).toContain("anime illustration");
    expect(anime).toContain("rain");
    expect(anime).toContain("tall, grey coat");
  });
});

describe("portrait stages", () => {
  it("draw, crop and check a portrait per card and the persona, and attach them on export", async () => {
    const { id, images } = await setup();
    const state = await run(id);
    expect(state.ready).toBe(true);
    const avatars = state.stages.filter((s) => s.id.startsWith("avatar:"));
    expect(avatars.map((s) => s.id)).toEqual(["avatar:alpha", "avatar:beta", "avatar:persona"]);
    expect(avatars.every((s) => s.summary === "768×768 portrait, matches its description")).toBe(true);
    expect(images()).toHaveLength(3);
    // Alpha has image tags, which win over Appearance; Beta has only Appearance.
    expect(JSON.stringify(images()[0]!.body)).toContain("probe, portrait");
    expect(JSON.stringify(images()[1]!.body)).toContain("CARD_BETA_APPEARANCE");

    const img = await app.inject({ method: "GET", url: `/api/projects/${id}/portraits/avatar%3Aalpha/image`, headers: { host } });
    expect(img.statusCode).toBe(200);
    expect((await sharp(img.rawPayload).metadata()).width).toBe(768);

    const zip = readZip((await app.inject({ method: "GET", url: `/api/projects/${id}/export`, headers: { host } })).rawPayload);
    const alpha = JSON.parse(zip.get("the-lamp-beneath-the-pier/characters/probe-alpha.marinara.json")!.toString());
    expect(alpha.data.avatar).toMatch(/^data:image\/webp;base64,/);
    const embedded = await sharp(Buffer.from(alpha.data.avatar.split(",")[1], "base64")).metadata();
    expect([embedded.format, embedded.width]).toEqual(["webp", 768]);
    const persona = JSON.parse(zip.get("the-lamp-beneath-the-pier/persona/probe-investigator.marinara.json")!.toString());
    expect(persona.data.avatar).toMatch(/^data:image\/webp;base64,/);
    expect(state.audit!.checked.join(" ")).toMatch(/Portraits against Appearance and style \(vision review\): 3 match/);
  });

  it("redraws once when the check finds a mismatch", async () => {
    const { id, images } = await setup({
      check: (n) => JSON.stringify(n === 1 ? { matches: false, problems: ["hair should be red"] } : { matches: true, problems: [] }),
    });
    const state = await run(id);
    expect(images()).toHaveLength(4);
    // Portraits render side by side, so the redraw may belong to any of them.
    expect(images().filter((r) => JSON.stringify(r.body).includes("hair should be red"))).toHaveLength(1);
    expect(state.stages.filter((s) => s.id.startsWith("avatar:")).every((s) => /matches its description/.test(s.summary ?? ""))).toBe(true);
  });

  it("keeps the portrait unchecked when the text model cannot look at it", async () => {
    const { id } = await setup({ check: () => "I cannot see images." });
    const state = await run(id);
    expect(state.ready).toBe(true);
    expect(state.stages.find((s) => s.id === "avatar:alpha")!.summary).toMatch(/not checked/);
  });

  it("re-renders only the portraits when the style changes, and can be turned off", async () => {
    const { id, images, chats } = await setup();
    await run(id);
    const textCalls = chats().length;
    await app.inject({ method: "PUT", url: `/api/projects/${id}/portraits`, headers: write, payload: { enabled: true, style: "anime", notes: "" } });
    const stale = (await app.inject({ method: "GET", url: `/api/projects/${id}/generation`, headers: { host } })).json() as GenerationState;
    expect(stale.stages.filter((s) => s.status === "stale").map((s) => s.id)).toEqual(["avatar:alpha", "avatar:beta", "avatar:persona"]);
    await run(id);
    expect(images()).toHaveLength(6);
    expect(JSON.stringify(images()[5]!.body)).toContain("anime illustration");
    // Only the three portrait checks ran on the text model.
    expect(chats().slice(textCalls).map((r) => stageOf(r).stage)).toEqual(["portrait-check", "portrait-check", "portrait-check"]);

    await app.inject({ method: "PUT", url: `/api/projects/${id}/portraits`, headers: write, payload: { enabled: false, style: "anime", notes: "" } });
    const off = (await app.inject({ method: "GET", url: `/api/projects/${id}/generation`, headers: { host } })).json() as GenerationState;
    expect(off.ready).toBe(true);
    expect(off.stages.some((s) => s.id.startsWith("avatar:"))).toBe(false);
    const zip = readZip((await app.inject({ method: "GET", url: `/api/projects/${id}/export`, headers: { host } })).rawPayload);
    expect(JSON.parse(zip.get("the-lamp-beneath-the-pier/characters/probe-alpha.marinara.json")!.toString()).data.avatar).toBeUndefined();
  });

  it("deletes portrait files with the project", async () => {
    const { id, dataDir } = await setup();
    await run(id);
    expect(existsSync(join(dataDir, "portraits", id))).toBe(true);
    await app.inject({ method: "DELETE", url: `/api/projects/${id}`, headers: { host, "x-adv-csrf": "1" } });
    expect(existsSync(join(dataDir, "portraits", id))).toBe(false);
  });
});
