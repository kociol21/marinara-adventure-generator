import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { requirementsSchema, type GenerationState } from "@adv/shared";
import { buildApp } from "../src/app.ts";
import { openDatabase, type Db } from "../src/db/database.ts";
import { MemorySecretStore } from "../src/secrets/secret-store.ts";
import type { Pipeline } from "../src/pipeline/runner.ts";
import { createPipeline } from "../src/pipeline/runner.ts";
import { createStagesRepo } from "../src/repos/stages.ts";
import { fakeFetch, type RecordedRequest } from "./fake-fetch.ts";
import { readZip } from "./zip-reader.ts";
import fixture from "../../../tools/marinara-test/pipeline-fixture.json" with { type: "json" };

const PORT = 7880;
const host = `127.0.0.1:${PORT}`;
const write = { host, "x-adv-csrf": "1", "content-type": "application/json" };

let app: FastifyInstance;
let db: Db;

const requirements = requirementsSchema.parse({
  idea: "Neutral probe pitch.",
  genre: "noir detective mystery",
  tone: ["neutral"],
  setting: { era: "probe era", place: "probe city" },
  startingSituation: "A probe begins.",
  maxNpcCards: 3,
});

/** Override replies per stage (e.g. to fail one stage); default comes from the shared fixture. */
type Override = (stage: string, sub: string | null, attempt: number) => string | undefined;

function stageOf(req: RecordedRequest) {
  const system = (req.body as { messages: Array<{ role: string; content: string }> }).messages[0]!.content;
  const stage = system.match(/^Stage: ([\w-]+)/m)?.[1] ?? "?";
  const sub = system.match(/^Card key: (\S+)/m)?.[1] ?? system.match(/^Lorebook: (\w+)/m)?.[1] ?? null;
  return { stage, sub, id: sub ? `${stage}:${sub}` : stage };
}

async function setup(override?: Override) {
  const attempts = new Map<string, number>();
  const fake = fakeFetch({
    "GET /models": () => ({ json: { data: [{ id: "m1" }] } }),
    "POST /chat/completions": (req) => {
      const { stage, sub, id } = stageOf(req);
      const n = (attempts.get(id) ?? 0) + 1;
      attempts.set(id, n);
      const custom = override?.(stage, sub, n);
      const f = fixture as Record<string, any>;
      const content =
        custom ?? JSON.stringify(stage === "card" ? f.cards[sub!] : stage === "lorebook" ? f.lorebooks[sub!] : f[stage]);
      return { json: { choices: [{ message: { content } }] } };
    },
  });
  db = openDatabase(":memory:");
  app = await buildApp({ db, secretStore: new MemorySecretStore(), dataDir: "x", port: PORT, fetch: fake.fetch });
  const conn = (
    await app.inject({ method: "POST", url: "/api/connections", headers: write, payload: { kind: "nano-gpt", name: "N", apiKey: "k" } })
  ).json();
  await app.inject({ method: "POST", url: `/api/connections/${conn.id}/models/fetch`, headers: write, payload: { capability: "text" } });
  await app.inject({ method: "PUT", url: "/api/assignments/text", headers: write, payload: { connectionId: conn.id, modelId: "m1" } });
  const id = (await app.inject({ method: "POST", url: "/api/projects", headers: write, payload: { title: "Probe Case" } })).json().id as string;
  await approve(id, requirements);
  const stageCalls = () => fake.requests.filter((r) => r.url.includes("chat/completions")).map((r) => stageOf(r).id);
  return { id, stageCalls };
}

async function approve(id: string, req: typeof requirements) {
  await app.inject({ method: "PUT", url: `/api/projects/${id}/requirements`, headers: write, payload: { requirements: req } });
  const res = await app.inject({ method: "POST", url: `/api/projects/${id}/requirements/approve`, headers: write, payload: {} });
  expect(res.statusCode).toBe(200);
}

const pipeline = () => (app as unknown as { pipeline: Pipeline }).pipeline;

async function runToEnd(id: string, url = `/api/projects/${id}/generation/start`): Promise<GenerationState> {
  const res = await app.inject({ method: "POST", url, headers: write, payload: { confirmUsage: true } });
  expect(res.statusCode, res.body).toBe(200);
  await pipeline().idle(id);
  return (await app.inject({ method: "GET", url: `/api/projects/${id}/generation`, headers: { host } })).json();
}

const LLM_STAGES = [
  "plan",
  "facts",
  "clues",
  "card:alpha",
  "card:beta",
  "persona",
  "lorebook:world",
  "lorebook:characters",
  "lorebook:plot",
  "opening",
  "audit-review",
  "audit-spoilers",
];

afterEach(async () => {
  await app?.close();
  db?.close();
});

describe("generation pipeline", () => {
  it("requires approved requirements and explicit usage confirmation", async () => {
    await setup();
    const id = (await app.inject({ method: "POST", url: "/api/projects", headers: write, payload: { title: "Unapproved" } })).json().id;
    const noConfirm = await app.inject({ method: "POST", url: `/api/projects/${id}/generation/start`, headers: write, payload: {} });
    expect(noConfirm.statusCode).toBe(400);
    const unapproved = await app.inject({ method: "POST", url: `/api/projects/${id}/generation/start`, headers: write, payload: { confirmUsage: true } });
    expect(unapproved.statusCode).toBe(400);
  });

  it("runs every stage, assembles a valid package and exports it", async () => {
    const { id, stageCalls } = await setup();
    const state = await runToEnd(id);
    expect(state.ready).toBe(true);
    expect(state.stages.map((s) => s.id)).toEqual([...LLM_STAGES.slice(0, 10), "assemble", "audit"]);
    expect(state.stages.every((s) => s.status === "done")).toBe(true);
    expect(stageCalls()).toEqual(LLM_STAGES);

    const project = (await app.inject({ method: "GET", url: `/api/projects/${id}`, headers: { host } })).json();
    expect(project).toMatchObject({ status: "ready", teaser: fixture.opening.teaser });

    const assembled = pipeline().assembled(id)!;
    const alpha = assembled.package.characters.find((c) => c.key === "alpha")!;
    expect(alpha.firstMessage).toBe("OPENING_MESSAGE_ALPHA");
    expect(assembled.package.lorebooks.map((l) => l.name)).toEqual(["Probe Case: World", "Probe Case: Characters", "Probe Case: Plot"]);
    expect(assembled.package.secretPlot?.description).toBe("SECRET_PLOT_ARC");

    const zipRes = await app.inject({ method: "GET", url: `/api/projects/${id}/export`, headers: { host } });
    expect(zipRes.statusCode).toBe(200);
    expect(zipRes.headers["content-type"]).toBe("application/zip");
    const files = readZip(zipRes.rawPayload);
    expect([...files.keys()]).toContain("probe-case/lorebooks/probe-case-plot.marinara.json");
    expect([...files.values()].map((b) => b.toString()).join("")).not.toContain("SECRET_PLOT_ARC");
  });

  it("never puts story content into the status view", async () => {
    const { id } = await setup();
    const state = await runToEnd(id);
    const text = JSON.stringify(state);
    for (const marker of ["PLAN_", "FACT_", "CLUE_", "CARD_", "LORE_", "SECRET_", "OPENING_MESSAGE"]) expect(text).not.toContain(marker);
  });

  it("resumes after a failure without redoing finished stages", async () => {
    let breakBeta = true;
    const { id, stageCalls } = await setup((stage, sub) => (stage === "card" && sub === "beta" && breakBeta ? "not json" : undefined));
    const failed = await runToEnd(id);
    expect(failed.ready).toBe(false);
    const beta = failed.stages.find((s) => s.id === "card:beta")!;
    expect(beta.status).toBe("failed");
    expect(beta.error).toMatch(/expected format/);
    expect(failed.stages.find((s) => s.id === "card:alpha")!.status).toBe("done");
    expect((await app.inject({ method: "GET", url: `/api/projects/${id}`, headers: { host } })).json().status).toBe("approved");

    breakBeta = false;
    const before = stageCalls().length;
    const resumed = await runToEnd(id);
    expect(resumed.ready).toBe(true);
    expect(stageCalls().slice(before)).toEqual([
      "card:beta",
      "persona",
      "lorebook:world",
      "lorebook:characters",
      "lorebook:plot",
      "opening",
      "audit-review",
      "audit-spoilers",
    ]);
  });

  it("regenerates one card and only what depends on it", async () => {
    const { id, stageCalls } = await setup();
    await runToEnd(id);
    const before = stageCalls().length;
    const state = await runToEnd(id, `/api/projects/${id}/generation/stages/card%3Aalpha/retry`);
    expect(state.ready).toBe(true);
    // The fixture returns the same card, so its output hash is unchanged and the opening is reused.
    expect(stageCalls().slice(before)).toEqual(["card:alpha"]);
  });

  it("marks everything stale when the approved requirements change", async () => {
    const { id, stageCalls } = await setup();
    await runToEnd(id);
    await approve(id, { ...requirements, tone: ["different"] });
    const stale = (await app.inject({ method: "GET", url: `/api/projects/${id}/generation`, headers: { host } })).json() as GenerationState;
    expect(stale.stages.find((s) => s.id === "plan")!.status).toBe("stale");
    const before = stageCalls().length;
    await runToEnd(id);
    expect(stageCalls().slice(before)).toEqual(LLM_STAGES);
  });

  it("sends code-check problems back to the model and accepts the repair", async () => {
    const tooMany = {
      ...fixture.plan,
      entities: fixture.plan.entities.map((e) => (e.type === "character" ? { ...e, isCard: true } : e)),
    };
    const { id, stageCalls } = await setup((stage, _sub, attempt) =>
      stage === "plan" && attempt === 1 ? JSON.stringify({ ...tooMany, openingCardKey: "alpha" }) : undefined,
    );
    // Limit 2 cards: the first plan has 3 card characters.
    await approve(id, { ...requirements, maxNpcCards: 2 });
    const state = await runToEnd(id);
    expect(state.ready).toBe(true);
    expect(stageCalls().filter((s) => s === "plan")).toHaveLength(2);
  });

  it("sends a too-thin result back for more material and counts the requests", async () => {
    const thinWorld = {
      entries: fixture.lorebooks.world.entries.map((e) => (e.type === "constant" ? e : { ...e, content: "LORE_SHORT", sticky: 3 })),
    };
    const { id, stageCalls } = await setup((stage, sub, attempt) =>
      stage === "lorebook" && sub === "world" && attempt === 1 ? JSON.stringify(thinWorld) : undefined,
    );
    const state = await runToEnd(id);
    expect(state.ready).toBe(true);
    expect(stageCalls().filter((s) => s === "lorebook:world")).toHaveLength(2);
    expect(state.stages.find((s) => s.id === "lorebook:world")!.calls).toBe(2);
    expect(state.stages.find((s) => s.id === "lorebook:plot")!.calls).toBe(1);
  });

  it("adds a constant Narrative voice entry when a prose style is set", async () => {
    const { id } = await setup();
    await runToEnd(id);
    const plain = pipeline().assembled(id)!.package.lorebooks.find((l) => l.key === "world")!;
    expect(plain.entries.some((e) => e.key === "narrative-voice")).toBe(false);

    await approve(id, {
      ...requirements,
      narration: { ...requirements.narration, style: "terse hard-boiled sentences, wry similes", inspirations: ["Raymond Chandler"] },
    });
    await runToEnd(id);
    const world = pipeline().assembled(id)!.package.lorebooks.find((l) => l.key === "world")!;
    const voice = world.entries[0]!;
    expect(voice).toMatchObject({ key: "narrative-voice", type: "constant", order: 1, noVector: true });
    expect(voice.content).toContain("Raymond Chandler");
    expect(voice.content).toContain("Do not quote them");
    expect(world.entries.filter((e) => e.key === "narrative-voice")).toHaveLength(1);
  });

  it("re-runs only a code stage when its version changes", async () => {
    const { id, stageCalls } = await setup();
    await runToEnd(id);
    // Simulate a project assembled by an older assemble version: its stored input hash no longer matches.
    db.prepare("UPDATE stage_run SET input_hash = 'old-version' WHERE project_id = ? AND stage = 'assemble'").run(id);
    const stale = (await app.inject({ method: "GET", url: `/api/projects/${id}/generation`, headers: { host } })).json() as GenerationState;
    expect(stale.stages.filter((s) => s.status === "stale").map((s) => s.id)).toEqual(["assemble"]);
    const before = stageCalls().length;
    const state = await runToEnd(id);
    expect(state.ready).toBe(true);
    expect(stageCalls().length).toBe(before);
  });

  it("reports an interrupted stage after a restart", async () => {
    const { id } = await setup();
    const stages = createStagesRepo(db);
    stages.start(id, "plan", "x");
    createPipeline({ stages, interview: {} as never, projects: {} as never, settings: {} as never, text: {} as never });
    expect(stages.all(id).get("plan")).toMatchObject({ status: "failed", error: expect.stringMatching(/Interrupted/) });
  });
});
