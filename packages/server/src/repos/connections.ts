import { randomUUID } from "node:crypto";
import type {
  Capability,
  CatalogModel,
  Connection,
  ConnectionKind,
  Task,
  TaskAssignment,
  UpdateConnectionInput,
} from "@adv/shared";
import { transaction, type Db } from "../db/database.ts";
import type { SecretsRepo } from "./secrets.ts";

interface ConnectionRow {
  id: string;
  name: string;
  kind: ConnectionKind;
  base_url: string;
  created_at: string;
  updated_at: string;
}

interface CatalogRow {
  connection_id: string;
  capability: Capability;
  model_id: string;
  name: string;
  source: CatalogModel["source"];
  billing: CatalogModel["billing"];
  quota_multiplier: number | null;
  context_length: number | null;
  fetched_at: string;
}

export const apiKeySecretName = (connectionId: string) => `connection:${connectionId}:api-key`;

const toCatalogModel = (row: CatalogRow): CatalogModel => ({
  connectionId: row.connection_id,
  capability: row.capability,
  modelId: row.model_id,
  name: row.name,
  source: row.source,
  billing: row.billing,
  quotaMultiplier: row.quota_multiplier,
  contextLength: row.context_length,
  fetchedAt: row.fetched_at,
});

export type CatalogEntry = Omit<CatalogModel, "connectionId" | "capability" | "fetchedAt">;

export function createConnectionsRepo(db: Db, secrets: SecretsRepo) {
  const toConnection = (row: ConnectionRow): Connection => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    baseUrl: row.base_url,
    hasApiKey: secrets.has(apiKeySecretName(row.id)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

  const get = (id: string): Connection | null => {
    const row = db.prepare("SELECT * FROM connection WHERE id = ?").get(id) as ConnectionRow | undefined;
    return row ? toConnection(row) : null;
  };

  const listModels = (connectionId: string, capability?: Capability): CatalogModel[] => {
    const rows = (
      capability
        ? db
            .prepare("SELECT * FROM model_catalog WHERE connection_id = ? AND capability = ? ORDER BY name COLLATE NOCASE")
            .all(connectionId, capability)
        : db.prepare("SELECT * FROM model_catalog WHERE connection_id = ? ORDER BY name COLLATE NOCASE").all(connectionId)
    ) as unknown as CatalogRow[];
    return rows.map(toCatalogModel);
  };

  const upsertModel = db.prepare(`
    INSERT INTO model_catalog (connection_id, capability, model_id, name, source, billing, quota_multiplier, context_length, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(connection_id, capability, model_id) DO UPDATE SET
      name = excluded.name, source = excluded.source, billing = excluded.billing,
      quota_multiplier = excluded.quota_multiplier, context_length = excluded.context_length, fetched_at = excluded.fetched_at
  `);

  return {
    list(): Connection[] {
      const rows = db.prepare("SELECT * FROM connection ORDER BY name COLLATE NOCASE").all() as unknown as ConnectionRow[];
      return rows.map(toConnection);
    },

    get,

    /** Server-side only: the stored API key for this connection. */
    apiKey(id: string): string | null {
      return secrets.reveal(apiKeySecretName(id));
    },

    create(input: { name: string; kind: ConnectionKind; baseUrl: string; apiKey?: string }): Connection {
      const id = randomUUID();
      const now = new Date().toISOString();
      db.prepare("INSERT INTO connection (id, name, kind, base_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(
        id,
        input.name,
        input.kind,
        input.baseUrl,
        now,
        now,
      );
      if (input.apiKey) secrets.set(apiKeySecretName(id), input.apiKey);
      return get(id)!;
    },

    update(id: string, input: UpdateConnectionInput): Connection | null {
      const current = get(id);
      if (!current) return null;
      db.prepare("UPDATE connection SET name = ?, base_url = ?, updated_at = ? WHERE id = ?").run(
        input.name ?? current.name,
        input.baseUrl ?? current.baseUrl,
        new Date().toISOString(),
        id,
      );
      return get(id);
    },

    setApiKey(id: string, apiKey: string): void {
      secrets.set(apiKeySecretName(id), apiKey);
    },

    delete(id: string): boolean {
      const removed = db.prepare("DELETE FROM connection WHERE id = ?").run(id).changes > 0;
      if (removed) secrets.delete(apiKeySecretName(id));
      return removed;
    },

    listModels,

    /**
     * Replace the fetched catalog for one capability. Manually added models survive a re-fetch,
     * because the provider list does not know about them.
     */
    replaceCatalog(connectionId: string, capability: Capability, entries: CatalogEntry[]): CatalogModel[] {
      const now = new Date().toISOString();
      transaction(db, () => {
        db.prepare("DELETE FROM model_catalog WHERE connection_id = ? AND capability = ? AND source != 'manual'").run(
          connectionId,
          capability,
        );
        for (const e of entries) {
          upsertModel.run(connectionId, capability, e.modelId, e.name, e.source, e.billing, e.quotaMultiplier, e.contextLength, now);
        }
      });
      return listModels(connectionId, capability);
    },

    addManualModel(connectionId: string, capability: Capability, modelId: string): CatalogModel {
      const existing = listModels(connectionId, capability).find((m) => m.modelId === modelId);
      if (existing) return existing;
      upsertModel.run(connectionId, capability, modelId, modelId, "manual", "unknown", null, null, new Date().toISOString());
      return listModels(connectionId, capability).find((m) => m.modelId === modelId)!;
    },

    removeModel(connectionId: string, capability: Capability, modelId: string): boolean {
      return (
        db
          .prepare("DELETE FROM model_catalog WHERE connection_id = ? AND capability = ? AND model_id = ?")
          .run(connectionId, capability, modelId).changes > 0
      );
    },

    listAssignments(): TaskAssignment[] {
      const rows = db.prepare("SELECT task, connection_id, model_id FROM task_assignment ORDER BY task").all() as Array<{
        task: Task;
        connection_id: string;
        model_id: string;
      }>;
      return rows.map((r) => ({ task: r.task, connectionId: r.connection_id, modelId: r.model_id }));
    },

    setAssignment(task: Task, connectionId: string, modelId: string): TaskAssignment {
      db.prepare(
        "INSERT INTO task_assignment (task, connection_id, model_id) VALUES (?, ?, ?) ON CONFLICT(task) DO UPDATE SET connection_id = excluded.connection_id, model_id = excluded.model_id",
      ).run(task, connectionId, modelId);
      return { task, connectionId, modelId };
    },

    clearAssignment(task: Task): boolean {
      return db.prepare("DELETE FROM task_assignment WHERE task = ?").run(task).changes > 0;
    },
  };
}

export type ConnectionsRepo = ReturnType<typeof createConnectionsRepo>;
