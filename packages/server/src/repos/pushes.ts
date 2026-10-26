import type { PushRecord } from "@adv/shared";
import type { Db } from "../db/database.ts";

/** Push to Marinara history per project, newest first. */
export function createPushesRepo(db: Db) {
  return {
    add(projectId: string, record: PushRecord): void {
      db.prepare("INSERT INTO marinara_push (id, project_id, pushed_at, record) VALUES (?, ?, ?, ?)").run(
        record.id,
        projectId,
        record.pushedAt,
        JSON.stringify(record),
      );
    },

    list(projectId: string): PushRecord[] {
      const rows = db.prepare("SELECT record FROM marinara_push WHERE project_id = ? ORDER BY pushed_at DESC").all(projectId) as Array<{ record: string }>;
      return rows.map((r) => JSON.parse(r.record) as PushRecord);
    },
  };
}

export type PushesRepo = ReturnType<typeof createPushesRepo>;
