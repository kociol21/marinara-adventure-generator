import type { StageStatus } from "@adv/shared";
import type { Db } from "../db/database.ts";

export interface StageRow {
  stage: string;
  status: StageStatus;
  inputHash: string | null;
  /** Input hash without audit notes. */
  baseHash: string | null;
  output: unknown;
  outputHash: string | null;
  summary: string | null;
  error: string | null;
  errorDetail: string | null;
  attempts: number;
  finishedAt: string | null;
}

interface RawRow {
  stage: string;
  status: StageStatus;
  input_hash: string | null;
  base_hash: string | null;
  output: string | null;
  output_hash: string | null;
  summary: string | null;
  error: string | null;
  error_detail: string | null;
  attempts: number;
  finished_at: string | null;
}

const toRow = (r: RawRow): StageRow => ({
  stage: r.stage,
  status: r.status,
  inputHash: r.input_hash,
  baseHash: r.base_hash,
  output: r.output === null ? null : JSON.parse(r.output),
  outputHash: r.output_hash,
  summary: r.summary,
  error: r.error,
  errorDetail: r.error_detail,
  attempts: r.attempts,
  finishedAt: r.finished_at,
});

export function createStagesRepo(db: Db) {
  return {
    all(projectId: string): Map<string, StageRow> {
      const rows = db.prepare("SELECT * FROM stage_run WHERE project_id = ?").all(projectId) as unknown as RawRow[];
      return new Map(rows.map((r) => [r.stage, toRow(r)]));
    },

    /** Marks a stage running. Its previous output stays until finish, so a revision can edit it. */
    start(projectId: string, stage: string, inputHash: string, baseHash: string): void {
      db.prepare(`
        INSERT INTO stage_run (project_id, stage, status, input_hash, base_hash, attempts, started_at)
        VALUES (?, ?, 'running', ?, ?, 1, ?)
        ON CONFLICT(project_id, stage) DO UPDATE SET
          status = 'running', input_hash = excluded.input_hash, base_hash = excluded.base_hash,
          attempts = stage_run.attempts + 1, started_at = excluded.started_at, error = NULL, error_detail = NULL
      `).run(projectId, stage, inputHash, baseHash, new Date().toISOString());
    },

    finish(projectId: string, stage: string, output: unknown, outputHash: string, summary: string): void {
      db.prepare(
        "UPDATE stage_run SET status = 'done', output = ?, output_hash = ?, summary = ?, finished_at = ? WHERE project_id = ? AND stage = ?",
      ).run(JSON.stringify(output), outputHash, summary, new Date().toISOString(), projectId, stage);
    },

    fail(projectId: string, stage: string, error: string, detail: string | null): void {
      db.prepare(
        "UPDATE stage_run SET status = 'failed', error = ?, error_detail = ?, finished_at = ? WHERE project_id = ? AND stage = ?",
      ).run(error, detail, new Date().toISOString(), projectId, stage);
    },

    /** Forget a stage's result so the next run regenerates it. */
    invalidate(projectId: string, stage: string): void {
      db.prepare(
        "UPDATE stage_run SET status = 'stale', input_hash = NULL, output = NULL, output_hash = NULL, summary = NULL WHERE project_id = ? AND stage = ?",
      ).run(projectId, stage);
    },

    /** Remove stages the current plan no longer has (e.g. a card that was dropped). */
    prune(projectId: string, keep: string[]): void {
      const placeholders = keep.map(() => "?").join(",");
      db.prepare(`DELETE FROM stage_run WHERE project_id = ? AND stage NOT IN (${placeholders})`).run(projectId, ...keep);
    },

    /** Model calls made by each stage's latest run (repairs included). */
    callCounts(projectId: string): Map<string, number> {
      const rows = db
        .prepare(`
          SELECT s.stage AS stage, COUNT(c.id) AS calls
          FROM stage_run s
          LEFT JOIN llm_call c ON c.project_id = s.project_id AND c.purpose = s.stage AND c.created_at >= s.started_at
          WHERE s.project_id = ?
          GROUP BY s.stage
        `)
        .all(projectId) as Array<{ stage: string; calls: number }>;
      return new Map(rows.map((r) => [r.stage, r.calls]));
    },

    /** Audit fix notes per stage, oldest first, for the given requirements basis. */
    notes(projectId: string, basis: string): Map<string, Array<{ round: number; note: string }>> {
      const rows = db
        .prepare("SELECT stage, round, note FROM stage_note WHERE project_id = ? AND basis = ? ORDER BY id")
        .all(projectId, basis) as Array<{ stage: string; round: number; note: string }>;
      const out = new Map<string, Array<{ round: number; note: string }>>();
      for (const r of rows) out.set(r.stage, [...(out.get(r.stage) ?? []), { round: r.round, note: r.note }]);
      return out;
    },

    /** Highest note round ever written (rounds keep counting across fix sessions). */
    lastRound(projectId: string, basis: string): number {
      const row = db.prepare("SELECT MAX(round) AS r FROM stage_note WHERE project_id = ? AND basis = ?").get(projectId, basis) as { r: number | null };
      return row.r ?? 0;
    },

    /** Fix rounds used in the current fix session. */
    fixRounds(projectId: string, basis: string): number {
      const session = db.prepare("SELECT after_round FROM audit_session WHERE project_id = ? AND basis = ?").get(projectId, basis) as
        | { after_round: number }
        | undefined;
      return this.lastRound(projectId, basis) - (session?.after_round ?? 0);
    },

    /** Start a new fix session: earlier notes stay (and keep their effect), the round budget resets. */
    newFixSession(projectId: string, basis: string): void {
      db.prepare(
        "INSERT INTO audit_session (project_id, basis, after_round) VALUES (?, ?, ?) ON CONFLICT(project_id, basis) DO UPDATE SET after_round = excluded.after_round",
      ).run(projectId, basis, this.lastRound(projectId, basis));
    },

    addNotes(projectId: string, basis: string, round: number, notes: Array<{ stage: string; note: string }>): void {
      const insert = db.prepare("INSERT INTO stage_note (project_id, basis, stage, round, note, created_at) VALUES (?, ?, ?, ?, ?, ?)");
      const now = new Date().toISOString();
      for (const n of notes) insert.run(projectId, basis, n.stage, round, n.note, now);
    },

    /** After a crash or restart nothing is running any more. */
    resetRunning(): void {
      db.prepare("UPDATE stage_run SET status = 'failed', error = 'Interrupted (the app stopped). Resume to continue.' WHERE status = 'running'").run();
    },
  };
}

export type StagesRepo = ReturnType<typeof createStagesRepo>;
