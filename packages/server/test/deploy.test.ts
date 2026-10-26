import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { openDatabase, type Db } from "../src/db/database.ts";
import { FileSecretStore, MemorySecretStore } from "../src/secrets/secret-store.ts";
import { isNewer } from "../src/routes/updates.ts";
import packageJson from "../package.json" with { type: "json" };
import { fakeFetch } from "./fake-fetch.ts";

const PORT = 7880;
const host = `127.0.0.1:${PORT}`;
const write = { host, "x-adv-csrf": "1", "content-type": "application/json" };

describe("config for Docker", () => {
  const dataDir = () => mkdtempSync(join(tmpdir(), "adv-config-"));

  it("listens on loopback with the OS credential store by default", () => {
    const c = loadConfig({ DATA_DIR: dataDir() }, []);
    expect(c.host).toBe("127.0.0.1");
    expect(c.secretStore).toBe("keyring");
  });

  it("accepts 0.0.0.0 and the file store, and nothing else", () => {
    const c = loadConfig({ DATA_DIR: dataDir(), HOST: "0.0.0.0", SECRET_STORE: "file" }, []);
    expect(c).toMatchObject({ host: "0.0.0.0", secretStore: "file" });
    expect(() => loadConfig({ DATA_DIR: dataDir(), HOST: "192.168.1.5" }, [])).toThrow(/HOST/);
    expect(() => loadConfig({ DATA_DIR: dataDir(), SECRET_STORE: "plain" }, [])).toThrow(/SECRET_STORE/);
  });
});

describe("file secret store", () => {
  it("keeps values in secrets.json in the data folder", () => {
    const dir = mkdtempSync(join(tmpdir(), "adv-secrets-"));
    const store = new FileSecretStore(dir);
    expect(store.get("a")).toBeNull();
    store.set("a", "one");
    store.set("b", "two");
    store.delete("a");
    store.delete("missing");
    expect(store.get("a")).toBeNull();
    expect(new FileSecretStore(dir).get("b")).toBe("two");
    expect(JSON.parse(readFileSync(join(dir, "secrets.json"), "utf8"))).toEqual({ b: "two" });
    if (process.platform !== "win32") expect(statSync(join(dir, "secrets.json")).mode & 0o777).toBe(0o600);
  });
});

describe("version comparison", () => {
  it("compares versions by number", () => {
    expect(isNewer("0.10.0", "0.9.9")).toBe(true);
    expect(isNewer("v0.2.2", "0.2.1")).toBe(true);
    expect(isNewer("0.2.1", "0.2.1")).toBe(false);
    expect(isNewer("0.2.0", "0.2.1")).toBe(false);
    expect(isNewer("1.0.0-beta", "0.9.0")).toBe(true);
  });
});

describe("update check", () => {
  let db: Db;
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
    db.close();
  });

  const setup = async (release: { status?: number; json?: unknown }) => {
    db = openDatabase(":memory:");
    const fake = fakeFetch({ "GET api.github.com/repos/kociol21/marinara-adventure-generator/releases/latest": () => release });
    app = await buildApp({ db, secretStore: new MemorySecretStore(), dataDir: "x", port: PORT, fetch: fake.fetch });
    return fake;
  };

  it("reports a newer release and asks GitHub at most once per period", async () => {
    const fake = await setup({ json: { tag_name: "v99.0.0", html_url: "https://github.com/kociol21/marinara-adventure-generator/releases/tag/v99.0.0" } });
    const res = await app.inject({ method: "GET", url: "/api/updates", headers: { host } });
    expect(res.json()).toEqual({
      enabled: true,
      current: packageJson.version,
      latest: "99.0.0",
      url: "https://github.com/kociol21/marinara-adventure-generator/releases/tag/v99.0.0",
      newer: true,
    });
    await app.inject({ method: "GET", url: "/api/updates", headers: { host } });
    expect(fake.requests).toHaveLength(1);
    // Nothing about the user goes with it.
    expect(fake.requests[0]!.body).toBeUndefined();
  });

  it("shows no update when GitHub fails or the release is not newer", async () => {
    await setup({ status: 404, json: { message: "Not Found" } });
    const res = await app.inject({ method: "GET", url: "/api/updates", headers: { host } });
    expect(res.json()).toMatchObject({ enabled: true, latest: null, newer: false });
  });

  it("never asks GitHub when the check is off", async () => {
    const fake = await setup({ json: { tag_name: "v99.0.0" } });
    await app.inject({ method: "PATCH", url: "/api/settings", headers: write, payload: { checkForUpdates: false } });
    const res = await app.inject({ method: "GET", url: "/api/updates", headers: { host } });
    expect(res.json()).toMatchObject({ enabled: false, newer: false });
    expect(fake.requests).toHaveLength(0);
  });
});
