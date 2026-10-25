import { requirementsSchema, type InterviewMessage, type Requirements } from "@adv/shared";
import type { Db } from "../db/database.ts";

interface RequirementsRow {
  version: number;
  data: string;
  assumptions: string;
  ready: number;
  approved_at: string | null;
}

export interface RequirementsVersion {
  version: number;
  requirements: Requirements;
  assumptions: string[];
  ready: boolean;
  approvedAt: string | null;
}

export function createInterviewRepo(db: Db) {
  return {
    messages(projectId: string): InterviewMessage[] {
      const rows = db
        .prepare("SELECT id, role, content, questions, created_at FROM interview_message WHERE project_id = ? ORDER BY id")
        .all(projectId) as Array<{ id: number; role: "user" | "assistant"; content: string; questions: string; created_at: string }>;
      return rows.map((r) => ({ id: r.id, role: r.role, content: r.content, questions: JSON.parse(r.questions), createdAt: r.created_at }));
    },

    addMessage(projectId: string, role: "user" | "assistant", content: string, questions: string[] = []): void {
      db.prepare("INSERT INTO interview_message (project_id, role, content, questions, created_at) VALUES (?, ?, ?, ?, ?)").run(
        projectId,
        role,
        content,
        JSON.stringify(questions),
        new Date().toISOString(),
      );
    },

    current(projectId: string): RequirementsVersion | null {
      const row = db
        .prepare("SELECT version, data, assumptions, ready, approved_at FROM requirements WHERE project_id = ? ORDER BY version DESC LIMIT 1")
        .get(projectId) as RequirementsRow | undefined;
      if (!row) return null;
      return {
        version: row.version,
        // Stored drafts are re-validated, so an older shape gains new defaults instead of breaking.
        requirements: requirementsSchema.parse(JSON.parse(row.data)),
        assumptions: JSON.parse(row.assumptions),
        ready: row.ready === 1,
        approvedAt: row.approved_at,
      };
    },

    /** Every change is a new version; approval marks one version and is dropped by the next edit. */
    save(projectId: string, requirements: Requirements, assumptions: string[], ready: boolean): RequirementsVersion {
      const latest = db.prepare("SELECT MAX(version) AS v FROM requirements WHERE project_id = ?").get(projectId) as { v: number | null };
      const version = (latest.v ?? 0) + 1;
      db.prepare(
        "INSERT INTO requirements (project_id, version, data, assumptions, ready, approved_at, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)",
      ).run(projectId, version, JSON.stringify(requirements), JSON.stringify(assumptions), ready ? 1 : 0, new Date().toISOString());
      return { version, requirements, assumptions, ready, approvedAt: null };
    },

    approve(projectId: string, version: number): string {
      const approvedAt = new Date().toISOString();
      db.prepare("UPDATE requirements SET approved_at = ? WHERE project_id = ? AND version = ?").run(approvedAt, projectId, version);
      return approvedAt;
    },
  };
}

export type InterviewRepo = ReturnType<typeof createInterviewRepo>;
