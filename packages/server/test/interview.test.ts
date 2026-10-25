import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { openDatabase, type Db } from "../src/db/database.ts";
import { MemorySecretStore } from "../src/secrets/secret-store.ts";
import { extractJson } from "../src/generation/text.ts";
import { isSpoilerQuestion, MAX_INTERVIEW_TURNS } from "../src/interview/interview.ts";
import { fakeFetch } from "./fake-fetch.ts";

const PORT = 7880;
const host = `127.0.0.1:${PORT}`;
const write = { host, "x-adv-csrf": "1", "content-type": "application/json" };

let app: FastifyInstance;
let db: Db;

const fullRequirements = {
  idea: "MODEL MAY NOT CHANGE THIS",
  genre: "noir detective mystery",
  subgenres: ["urban fantasy"],
  tone: ["gritty", "wry"],
  setting: { era: "alternate 1940", place: "New York", technology: "1940s", supernatural: "magic is mundane" },
  startingSituation: "A small-time private investigator gets a visitor in red.",
  maxNpcCards: 4,
};

const turn = (over: Record<string, unknown> = {}) => ({
  message: "Got it.",
  questions: ["Gritty or playful?", "Who is the real killer?", "Should the case end in a twist?", "How long should it be?"],
  requirements: fullRequirements,
  assumptions: ["Length: medium"],
  readyForSummary: true,
  ...over,
});

/** Scripted model: each chat completion returns the next reply in the list. */
async function setup(replies: string[]) {
  let i = 0;
  const fake = fakeFetch({
    "GET /models": () => ({ json: { data: [{ id: "m1" }] } }),
    "POST /chat/completions": () => ({ json: { choices: [{ message: { content: replies[Math.min(i++, replies.length - 1)] } }] } }),
  });
  db = openDatabase(":memory:");
  app = await buildApp({ db, secretStore: new MemorySecretStore(), dataDir: "x", port: PORT, fetch: fake.fetch });
  return fake;
}

async function assignText() {
  const conn = (
    await app.inject({ method: "POST", url: "/api/connections", headers: write, payload: { kind: "nano-gpt", name: "N", apiKey: "k" } })
  ).json();
  await app.inject({ method: "POST", url: `/api/connections/${conn.id}/models/fetch`, headers: write, payload: { capability: "text" } });
  const res = await app.inject({ method: "PUT", url: "/api/assignments/text", headers: write, payload: { connectionId: conn.id, modelId: "m1" } });
  expect(res.statusCode).toBe(200);
}

async function project() {
  return (await app.inject({ method: "POST", url: "/api/projects", headers: write, payload: { title: "Noir" } })).json().id as string;
}

const say = (id: string, content: string) =>
  app.inject({ method: "POST", url: `/api/projects/${id}/interview/messages`, headers: write, payload: { content } });

afterEach(async () => {
  await app?.close();
  db?.close();
});

describe("interview helpers", () => {
  it("flags questions about the hidden story", () => {
    for (const q of ["Who is the killer?", "What twist do you want?", "What is she secretly hiding?", "How should it end — what's the ending?"]) {
      expect(isSpoilerQuestion(q), q).toBe(true);
    }
    for (const q of ["Gritty or playful?", "How many characters at most?", "Second or third person?", "Any topics to avoid?"]) {
      expect(isSpoilerQuestion(q), q).toBe(false);
    }
  });

  it("extracts JSON from fenced or chatty replies", () => {
    expect(extractJson('Sure!\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here: {"a": {"b": 2}} done')).toEqual({ a: { b: 2 } });
    expect(() => extractJson("no json")).toThrow();
  });
});

describe("interview", () => {
  it("refuses to run without an assigned text model and keeps the message", async () => {
    await setup([]);
    const id = await project();
    const res = await say(id, "Noir in 1940 New York");
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/Connections/);
    expect(res.json().state.messages).toHaveLength(1);
  });

  it("stores the turn, keeps the player's pitch and drops spoiler questions", async () => {
    const { requests } = await setup([JSON.stringify(turn())]);
    await assignText();
    const id = await project();
    const res = await say(id, "Detective noir, alternate 1940 New York, max 4 characters, a woman in red walks in.");
    expect(res.statusCode).toBe(200);
    const state = res.json();
    expect(state.requirements.idea).toBe("Detective noir, alternate 1940 New York, max 4 characters, a woman in red walks in.");
    expect(state.requirements.genre).toBe("noir detective mystery");
    const asked = state.messages.at(-1).questions;
    expect(asked).toEqual(["Gritty or playful?", "How long should it be?"]);
    expect(state.readyForSummary).toBe(true);
    expect(state.missing).toEqual([]);

    const prompt = requests.find((r) => r.url.includes("chat/completions"))!.body as { messages: Array<{ role: string; content: string }> };
    expect(prompt.messages[0]!.role).toBe("system");
    expect(prompt.messages[0]!.content).toMatch(/Never invent, suggest, hint at or ask about secrets/);

    const project_ = (await app.inject({ method: "GET", url: `/api/projects/${id}`, headers: { host } })).json();
    expect(project_.status).toBe("interview");
  });

  it("repairs one invalid reply, then gives up with a clear error", async () => {
    const { requests } = await setup(["not json at all", JSON.stringify(turn())]);
    await assignText();
    const id = await project();
    expect((await say(id, "idea")).statusCode).toBe(200);
    const calls = requests.filter((r) => r.url.includes("chat/completions"));
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(calls[1]!.body)).toContain("Your reply was not valid");

    await app.close();
    db.close();
    await setup(["nope", "still nope"]);
    await assignText();
    const id2 = await project();
    const res = await say(id2, "idea");
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toMatch(/expected format/);
  });

  it("is not ready while essentials are missing, even if the model says so", async () => {
    await setup([JSON.stringify(turn({ requirements: { ...fullRequirements, startingSituation: "" } }))]);
    await assignText();
    const id = await project();
    const state = (await say(id, "idea")).json();
    expect(state.readyForSummary).toBe(false);
    expect(state.missing).toEqual(["startingSituation"]);
    const approve = await app.inject({ method: "POST", url: `/api/projects/${id}/requirements/approve`, headers: write, payload: {} });
    expect(approve.statusCode).toBe(400);
  });

  it("stops asking after the turn limit", async () => {
    await setup([JSON.stringify(turn({ readyForSummary: false }))]);
    await assignText();
    const id = await project();
    let state;
    for (let i = 0; i < MAX_INTERVIEW_TURNS; i++) state = (await say(id, `answer ${i}`)).json();
    expect(state.readyForSummary).toBe(true);
    expect(state.messages.at(-1).questions).toEqual([]);
  });

  it("approves, and a later edit needs approval again", async () => {
    await setup([JSON.stringify(turn())]);
    await assignText();
    const id = await project();
    const state = (await say(id, "idea")).json();

    const ok = await app.inject({ method: "POST", url: `/api/projects/${id}/requirements/approve`, headers: write, payload: {} });
    expect(ok.json().approvedAt).toBeTruthy();
    expect((await app.inject({ method: "GET", url: `/api/projects/${id}`, headers: { host } })).json().status).toBe("approved");

    const edited = await app.inject({
      method: "PUT",
      url: `/api/projects/${id}/requirements`,
      headers: write,
      payload: { requirements: { ...state.requirements, maxNpcCards: 3 } },
    });
    expect(edited.json()).toMatchObject({ approvedAt: null, requirements: { maxNpcCards: 3 } });
  });

  it("logs model calls without prompt text", async () => {
    await setup([JSON.stringify(turn())]);
    await assignText();
    const id = await project();
    await say(id, "SECRET_PITCH_TEXT");
    const rows = db.prepare("SELECT * FROM llm_call").all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ project_id: id, purpose: "interview", model_id: "m1", ok: 1 });
    expect(JSON.stringify(rows)).not.toContain("SECRET_PITCH_TEXT");
  });
});
