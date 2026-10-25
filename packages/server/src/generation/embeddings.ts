import type { Db } from "../db/database.ts";
import type { ConnectionsRepo } from "../repos/connections.ts";
import { createAdapter, errorMessage, type AdapterDeps } from "../connections/adapters.ts";
import { GenerationError } from "./text.ts";

const BATCH = 64;

/**
 * Embeddings through the connection assigned to the "embedding" task, used by the audit to find
 * paraphrased duplicates. Optional: without an assignment the audit reports the check as not run.
 */
export function createEmbedder(db: Db, connections: ConnectionsRepo, deps: AdapterDeps) {
  const log = db.prepare(
    "INSERT INTO llm_call (project_id, task, purpose, connection_id, model_id, ok, latency_ms, error, created_at) VALUES (?, 'embedding', ?, ?, ?, ?, ?, ?, ?)",
  );

  const assignment = () => {
    const a = connections.listAssignments().find((x) => x.task === "embedding");
    const connection = a ? connections.get(a.connectionId) : null;
    return a && connection ? { modelId: a.modelId, connection } : null;
  };

  return {
    /** "Connection · model" when assigned, else null. */
    describe(): string | null {
      const a = assignment();
      return a ? `${a.connection.name} · ${a.modelId}` : null;
    },

    async embed(texts: string[], projectId: string, purpose: string): Promise<number[][]> {
      const a = assignment();
      if (!a) throw new GenerationError("No embedding model is assigned.", "not-assigned");
      const adapter = createAdapter(a.connection, connections.apiKey(a.connection.id), deps);
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += BATCH) {
        const start = Date.now();
        try {
          out.push(...(await adapter.embed(a.modelId, texts.slice(i, i + BATCH))));
          log.run(projectId, purpose, a.connection.id, a.modelId, 1, Date.now() - start, null, new Date().toISOString());
        } catch (error) {
          log.run(projectId, purpose, a.connection.id, a.modelId, 0, Date.now() - start, errorMessage(error), new Date().toISOString());
          throw new GenerationError(errorMessage(error), "provider");
        }
      }
      return out;
    },
  };
}

export type Embedder = ReturnType<typeof createEmbedder>;

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
