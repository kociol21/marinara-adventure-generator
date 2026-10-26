import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { migrate, openDatabase, type Db } from "../src/db/database.ts";
import { migrations } from "../src/db/migrations.ts";
import { MemorySecretStore } from "../src/secrets/secret-store.ts";

const PORT = 7880;
const host = `127.0.0.1:${PORT}`;
const write = { host, "x-adv-csrf": "1", "content-type": "application/json" };

let db: Db;
let store: MemorySecretStore;
let app: FastifyInstance;

beforeEach(async () => {
  db = openDatabase(":memory:");
  store = new MemorySecretStore();
  app = await buildApp({ db, secretStore: store, dataDir: "test-data", port: PORT });
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe("security", () => {
  it("rejects requests whose Host is not loopback on a trusted port (DNS rebinding)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health", headers: { host: "evil.example:7880" } });
    expect(res.statusCode).toBe(403);
  });

  it("rejects writes without the CSRF header", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { host, "content-type": "application/json" },
      payload: { title: "X" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects writes from a foreign Origin even with the header", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { ...write, origin: "https://evil.example" },
      payload: { title: "X" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("projects", () => {
  it("creates, lists, renames and deletes a project", async () => {
    const created = await app.inject({ method: "POST", url: "/api/projects", headers: write, payload: { title: "  Probe  " } });
    expect(created.statusCode).toBe(201);
    const project = created.json();
    expect(project).toMatchObject({ title: "Probe", status: "draft", teaser: "" });

    const list = await app.inject({ method: "GET", url: "/api/projects", headers: { host } });
    expect(list.json()).toHaveLength(1);

    const renamed = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}`,
      headers: write,
      payload: { title: "Renamed" },
    });
    expect(renamed.json().title).toBe("Renamed");

    const deleted = await app.inject({ method: "DELETE", url: `/api/projects/${project.id}`, headers: { host, "x-adv-csrf": "1" } });
    expect(deleted.statusCode).toBe(204);
    const missing = await app.inject({ method: "GET", url: `/api/projects/${project.id}`, headers: { host } });
    expect(missing.statusCode).toBe(404);
  });

  it("validates input", async () => {
    const res = await app.inject({ method: "POST", url: "/api/projects", headers: write, payload: { title: "" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("Invalid request");
  });
});

describe("settings", () => {
  it("returns safe defaults and persists updates", async () => {
    const defaults = await app.inject({ method: "GET", url: "/api/settings", headers: { host } });
    expect(defaults.json()).toEqual({ showSpoilers: false, maxAutoFixAttempts: 2, judgeThreshold: 0.7, judgeMaxRounds: 4, marinaraBaseUrl: "", checkForUpdates: true });

    const updated = await app.inject({ method: "PATCH", url: "/api/settings", headers: write, payload: { maxAutoFixAttempts: 3 } });
    expect(updated.json().maxAutoFixAttempts).toBe(3);
    expect(updated.json().showSpoilers).toBe(false);
  });

  it("leaves untouched keys alone on a partial update", async () => {
    await app.inject({ method: "PATCH", url: "/api/settings", headers: write, payload: { maxAutoFixAttempts: 3 } });
    const res = await app.inject({
      method: "PATCH",
      url: "/api/settings",
      headers: write,
      payload: { marinaraBaseUrl: "http://127.0.0.1:7870" },
    });
    expect(res.json()).toMatchObject({ maxAutoFixAttempts: 3, marinaraBaseUrl: "http://127.0.0.1:7870" });
  });

  it("rejects unknown keys", async () => {
    const res = await app.inject({ method: "PATCH", url: "/api/settings", headers: write, payload: { apiKey: "x" } });
    expect(res.statusCode).toBe(400);
  });

  it("rejects out-of-range values", async () => {
    const res = await app.inject({ method: "PATCH", url: "/api/settings", headers: write, payload: { maxAutoFixAttempts: 99 } });
    expect(res.statusCode).toBe(400);
  });
});

describe("secrets", () => {
  it("stores values in the secret store and never returns them", async () => {
    const put = await app.inject({
      method: "PUT",
      url: "/api/secrets/connection:abc:api-key",
      headers: write,
      payload: { value: "sk-test-value" },
    });
    expect(put.statusCode).toBe(200);
    expect(put.body).not.toContain("sk-test-value");
    expect(store.get("connection:abc:api-key")).toBe("sk-test-value");

    const list = await app.inject({ method: "GET", url: "/api/secrets", headers: { host } });
    expect(list.body).not.toContain("sk-test-value");
    expect(list.json()[0].name).toBe("connection:abc:api-key");

    const readBack = await app.inject({ method: "GET", url: "/api/secrets/connection:abc:api-key", headers: { host } });
    expect(readBack.statusCode).toBe(404);

    const rows = db.prepare("SELECT * FROM secret_ref").all();
    expect(JSON.stringify(rows)).not.toContain("sk-test-value");
  });

  it("deletes from both the store and the index", async () => {
    await app.inject({ method: "PUT", url: "/api/secrets/x", headers: write, payload: { value: "v" } });
    const res = await app.inject({ method: "DELETE", url: "/api/secrets/x", headers: { host, "x-adv-csrf": "1" } });
    expect(res.statusCode).toBe(204);
    expect(store.get("x")).toBeNull();
  });
});

describe("migrations", () => {
  it("is idempotent", () => {
    migrate(db);
    const { user_version } = db.prepare("PRAGMA user_version").get() as { user_version: number };
    expect(user_version).toBe(migrations.length);
  });

  it("refuses a database from a newer app version", () => {
    db.exec(`PRAGMA user_version = ${migrations.length + 1}`);
    expect(() => migrate(db)).toThrow(/newer than this app/);
  });
});
