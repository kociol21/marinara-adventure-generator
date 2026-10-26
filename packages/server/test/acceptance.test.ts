import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { requirementsSchema, type AdventurePackage, type ExportSummary, type GenerationState } from "@adv/shared";
import { buildApp } from "../src/app.ts";
import { openDatabase, type Db } from "../src/db/database.ts";
import { MemorySecretStore } from "../src/secrets/secret-store.ts";
import type { Pipeline } from "../src/pipeline/runner.ts";
import { buildExport, findSecretLeaks, SecretLeakError } from "../src/marinara/export.ts";
import { runActivationTrials } from "../src/audit/activation-trials.ts";
import { probePackage } from "./fixtures/probe-package.ts";
import { fakeFetch, type RecordedRequest } from "./fake-fetch.ts";
import { readZip } from "./zip-reader.ts";
import fixture from "../../../tools/marinara-test/pipeline-fixture.json" with { type: "json" };

/**
 * Acceptance criteria (spec §19) that code can check on a neutral adventure. The others are
 * mapped to their tests and manual checks in docs/03-kryteria-akceptacji.md.
 */

const clone = (): AdventurePackage => structuredClone(probePackage);

describe("criterion 6: lorebook trigger trials", () => {
  it("passes own-key hits, small-talk misses and private-lore isolation on the probe adventure", () => {
    const t = runActivationTrials(clone());
    expect(t.hits.run).toBeGreaterThan(5);
    expect(t.private.run).toBeGreaterThan(0);
    expect(t.findings).toEqual([]);
  });

  it("flags a key too general for play and an entry its own key cannot reach", () => {
    const pkg = clone();
    const world = pkg.lorebooks[0]!;
    world.entries[1]!.keys = ["day"];
    world.entries[2]!.type = "selective";
    world.entries[2]!.secondaryKeys = ["never-said"];
    world.entries[2]!.selectiveLogic = "not_any";
    world.entries[2]!.keys = ["Ash never-said"];
    const t = runActivationTrials(pkg);
    expect(t.findings.map((f) => f.summary)).toEqual(
      expect.arrayContaining([expect.stringMatching(/entry #2 fires on ordinary small talk/), expect.stringMatching(/entry #3 does not fire on its own key/)]),
    );
    expect(t.findings.every((f) => f.severity === "minor" && f.target === "lorebook:world")).toBe(true);
  });
});

describe("criterion 7 and 10: the bundle", () => {
  it("separates configured, built and verified vectors, and greets only from the opening card", () => {
    const pkg = clone();
    pkg.lorebooks[0]!.vectors.enabled = true;
    pkg.characters[1]!.firstMessage = "BETA_ENTRANCE";
    const { manifest, files } = buildExport(pkg);
    expect(manifest.vectors[0]).toMatchObject({ status: "configured-not-built", configured: true, built: false, verifiedInGame: false });
    expect(manifest.secretPlot).toBe("not-included");

    const beta = JSON.parse(files.find((f) => f.path.endsWith("probe-beta.marinara.json"))!.data.toString()).data.data;
    expect(beta.first_mes).toBe("");
    expect(beta.alternate_greetings).toEqual(["BETA_ENTRANCE"]);

    const guide = files.find((f) => f.path.endsWith("START-HERE.md"))!.data.toString();
    expect(guide).toMatch(/Only Probe Alpha has a greeting/);
    expect(guide).toContain("Semantic Search (Embeddings)");
    // Only what the player may see: names and the teaser, never field contents.
    expect(guide).not.toMatch(/ALPHA_|BETA_|WORLD_|PLOT_|PERSONA_/);
  });
});

describe("criterion 12: no keys or tokens in the export", () => {
  it("blocks files that carry a stored secret or a token-shaped string", () => {
    const pkg = clone();
    pkg.characters[0]!.description = "Notes: sk-proj-ABCDEFGHIJKLMNOPQRSTUV123";
    expect(() => buildExport(pkg)).toThrow(SecretLeakError);
    const known = clone();
    known.characters[1]!.scenario = "The password is hunter2hunter2.";
    expect(() => buildExport(known, { secretValues: ["hunter2hunter2"] })).toThrow(SecretLeakError);
    expect(() => buildExport(clone(), { secretValues: ["hunter2hunter2"] })).not.toThrow();
  });

  it("does not mistake an embedded WebP portrait for a token", () => {
    const files = [{ path: "a.json", data: Buffer.from(`{"avatar":"data:image/webp;base64,${Buffer.alloc(3000, 0xfe).toString("base64")}"}`) }];
    expect(findSecretLeaks(files)).toEqual([]);
  });
});

// ── Through the app: summary before download, the full bundle, and the secret guard on the route ──

const PORT = 7880;
const host = `127.0.0.1:${PORT}`;
const write = { host, "x-adv-csrf": "1", "content-type": "application/json" };
let app: FastifyInstance;
let db: Db;
afterEach(async () => {
  await app?.close();
  db?.close();
});

const stageOf = (r: RecordedRequest) => {
  const system = (r.body as { messages: Array<{ content: string }> }).messages[0]!.content;
  return { stage: system.match(/^Stage: ([\w-]+)/m)?.[1] ?? "?", sub: system.match(/^Card key: (\S+)/m)?.[1] ?? system.match(/^Lorebook: (\w+)/m)?.[1] ?? null };
};

async function generated(apiKey: string) {
  const fake = fakeFetch({
    "GET /models": () => ({ json: { data: [{ id: "m1" }] } }),
    "POST /chat/completions": (req) => {
      const { stage, sub } = stageOf(req);
      const f = fixture as Record<string, any>;
      return { json: { choices: [{ message: { content: JSON.stringify(stage === "card" ? f.cards[sub!] : stage === "lorebook" ? f.lorebooks[sub!] : f[stage]) } }] } };
    },
  });
  db = openDatabase(":memory:");
  app = await buildApp({ db, secretStore: new MemorySecretStore(), dataDir: mkdtempSync(join(tmpdir(), "acceptance-")), port: PORT, fetch: fake.fetch });
  const conn = (await app.inject({ method: "POST", url: "/api/connections", headers: write, payload: { kind: "nano-gpt", name: "N", apiKey } })).json();
  await app.inject({ method: "POST", url: `/api/connections/${conn.id}/models/fetch`, headers: write, payload: { capability: "text" } });
  await app.inject({ method: "PUT", url: "/api/assignments/text", headers: write, payload: { connectionId: conn.id, modelId: "m1" } });
  const id = (await app.inject({ method: "POST", url: "/api/projects", headers: write, payload: { title: "Probe Case" } })).json().id as string;
  const requirements = requirementsSchema.parse({
    idea: "Neutral probe pitch.",
    genre: "noir detective mystery",
    tone: ["neutral"],
    setting: { era: "probe era", place: "probe city" },
    startingSituation: "A probe begins.",
    maxNpcCards: 3,
  });
  await app.inject({ method: "PUT", url: `/api/projects/${id}/requirements`, headers: write, payload: { requirements } });
  await app.inject({ method: "POST", url: `/api/projects/${id}/requirements/approve`, headers: write, payload: {} });
  // Criterion 11: nothing that spends quota runs without the explicit flag.
  expect((await app.inject({ method: "POST", url: `/api/projects/${id}/generation/start`, headers: write, payload: {} })).statusCode).toBe(400);
  await app.inject({ method: "POST", url: `/api/projects/${id}/generation/start`, headers: write, payload: { confirmUsage: true } });
  await (app as unknown as { pipeline: Pipeline }).pipeline.idle(id);
  return id;
}

describe("export through the app", () => {
  it("summarises the bundle before download and ships requirements, guide, QA report and manifest", async () => {
    const id = await generated("key-not-in-any-file");
    const state = (await app.inject({ method: "GET", url: `/api/projects/${id}/generation`, headers: { host } })).json() as GenerationState;
    expect(state.ready).toBe(true);
    expect(state.audit!.checked.join("\n")).toMatch(/Lorebook trigger trials \(activation simulator\): \d+ own-key hits/);

    const summary = (await app.inject({ method: "GET", url: `/api/projects/${id}/export/summary`, headers: { host } })).json() as ExportSummary;
    expect(summary.manifest.counts.characters).toBeGreaterThan(0);
    expect(summary.manifest.audit.ran).toBe(true);
    expect(summary.manifest.requirementsApprovedAt).not.toBeNull();
    expect(summary.manifest.notIncluded.length).toBeGreaterThan(0);

    const zip = readZip((await app.inject({ method: "GET", url: `/api/projects/${id}/export`, headers: { host } })).rawPayload);
    const names = [...zip.keys()];
    for (const f of ["START-HERE.md", "requirements.md", "qa-report.md", "manifest.json"]) expect(names).toContain(`the-lamp-beneath-the-pier/${f}`);
    const sheet = zip.get("the-lamp-beneath-the-pier/requirements.md")!.toString();
    expect(sheet).toContain("Neutral probe pitch.");
    expect(sheet).toContain("noir detective mystery");
  });

  it("refuses to export when a stored key appears in the files, without naming it", async () => {
    // The connection's key equals text a card carries, as if a key had leaked into generated content.
    const id = await generated("CARD_BETA_APPEARANCE");
    for (const url of [`/api/projects/${id}/export`, `/api/projects/${id}/export/summary`]) {
      const res = await app.inject({ method: "GET", url, headers: { host } });
      expect(res.statusCode).toBe(409);
      expect(res.body).toMatch(/Export blocked/);
      expect(res.body).not.toContain("CARD_BETA_APPEARANCE");
    }
  });
});
