import type { SecretInfo } from "@adv/shared";
import type { Db } from "../db/database.ts";
import type { SecretStore } from "../secrets/secret-store.ts";

/** Pairs the OS secret store (values) with the secret_ref table (names), so we can list without reading values. */
export function createSecretsRepo(db: Db, store: SecretStore) {
  return {
    list(): SecretInfo[] {
      const rows = db.prepare("SELECT name, updated_at FROM secret_ref ORDER BY name").all() as Array<{
        name: string;
        updated_at: string;
      }>;
      return rows.map((row) => ({ name: row.name, updatedAt: row.updated_at }));
    },

    has(name: string): boolean {
      return db.prepare("SELECT 1 FROM secret_ref WHERE name = ?").get(name) !== undefined;
    },

    /** Server-side only. Never return this through an HTTP route. */
    reveal(name: string): string | null {
      return store.get(name);
    },

    set(name: string, value: string): SecretInfo {
      store.set(name, value);
      const updatedAt = new Date().toISOString();
      db.prepare(
        "INSERT INTO secret_ref (name, updated_at) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET updated_at = excluded.updated_at",
      ).run(name, updatedAt);
      return { name, updatedAt };
    },

    delete(name: string): boolean {
      store.delete(name);
      return db.prepare("DELETE FROM secret_ref WHERE name = ?").run(name).changes > 0;
    },
  };
}

export type SecretsRepo = ReturnType<typeof createSecretsRepo>;
