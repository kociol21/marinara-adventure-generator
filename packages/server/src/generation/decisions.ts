import type { Db } from "../db/database.ts";
import type { ConnectionsRepo } from "../repos/connections.ts";
import { createAdapter, errorMessage, type AdapterDeps, type DecisionAnswer, type DecisionQuestion } from "../connections/adapters.ts";
import { GenerationError } from "./text.ts";

/** Questions per request; the Decisions API caps a request at 64k tokens. */
const BATCH = 8;
/** About 25k tokens of state, well inside the per-request limit. */
const MAX_STATE_CHARS = 100_000;

/**
 * Decision-model answers (TypeSafe Jev and compatible) through the connection assigned to the
 * "decision" task, used by the audit's judge. Optional: without an assignment the judge does not run.
 */
export function createDecider(db: Db, connections: ConnectionsRepo, deps: AdapterDeps) {
  const log = db.prepare(
    "INSERT INTO llm_call (project_id, task, purpose, connection_id, model_id, ok, latency_ms, error, created_at) VALUES (?, 'decision', ?, ?, ?, ?, ?, ?, ?)",
  );

  const assignment = () => {
    const a = connections.listAssignments().find((x) => x.task === "decision");
    const connection = a ? connections.get(a.connectionId) : null;
    return a && connection ? { modelId: a.modelId, connection } : null;
  };

  return {
    /** "Connection · model" when assigned, else null. */
    describe(): string | null {
      const a = assignment();
      return a ? `${a.connection.name} · ${a.modelId}` : null;
    },

    async decide(projectId: string, purpose: string, state: unknown, questions: Record<string, DecisionQuestion>): Promise<Record<string, DecisionAnswer>> {
      const a = assignment();
      if (!a) throw new GenerationError("No decision model is assigned.", "not-assigned");
      const serialized = typeof state === "string" ? state : JSON.stringify(state);
      if (serialized.length > MAX_STATE_CHARS) throw new GenerationError("This part is too long for the decision model.", "provider");
      const adapter = createAdapter(a.connection, connections.apiKey(a.connection.id), deps);
      const keys = Object.keys(questions);
      const out: Record<string, DecisionAnswer> = {};
      for (let i = 0; i < keys.length; i += BATCH) {
        const batch = Object.fromEntries(keys.slice(i, i + BATCH).map((k) => [k, questions[k]!]));
        const start = Date.now();
        try {
          Object.assign(out, await adapter.decide(a.modelId, state, batch));
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

export type Decider = ReturnType<typeof createDecider>;
