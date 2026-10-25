import { randomUUID } from "node:crypto";
import type { CreateProjectInput, Project, ProjectStatus, UpdateProjectInput } from "@adv/shared";
import type { Db } from "../db/database.ts";

interface ProjectRow {
  id: string;
  title: string;
  status: ProjectStatus;
  teaser: string;
  created_at: string;
  updated_at: string;
}

const toProject = (row: ProjectRow): Project => ({
  id: row.id,
  title: row.title,
  status: row.status,
  teaser: row.teaser,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export function createProjectsRepo(db: Db) {
  const get = (id: string): Project | null => {
    const row = db.prepare("SELECT * FROM project WHERE id = ?").get(id) as ProjectRow | undefined;
    return row ? toProject(row) : null;
  };

  return {
    list(): Project[] {
      const rows = db.prepare("SELECT * FROM project ORDER BY updated_at DESC").all() as unknown as ProjectRow[];
      return rows.map(toProject);
    },

    get,

    create(input: CreateProjectInput): Project {
      const now = new Date().toISOString();
      const id = randomUUID();
      db.prepare("INSERT INTO project (id, title, status, teaser, created_at, updated_at) VALUES (?, ?, 'draft', '', ?, ?)").run(
        id,
        input.title,
        now,
        now,
      );
      return get(id)!;
    },

    update(id: string, input: UpdateProjectInput): Project | null {
      const current = get(id);
      if (!current) return null;
      db.prepare("UPDATE project SET title = ?, teaser = ?, updated_at = ? WHERE id = ?").run(
        input.title ?? current.title,
        input.teaser ?? current.teaser,
        new Date().toISOString(),
        id,
      );
      return get(id);
    },

    setStatus(id: string, status: ProjectStatus): void {
      db.prepare("UPDATE project SET status = ?, updated_at = ? WHERE id = ?").run(status, new Date().toISOString(), id);
    },

    delete(id: string): boolean {
      return db.prepare("DELETE FROM project WHERE id = ?").run(id).changes > 0;
    },
  };
}

export type ProjectsRepo = ReturnType<typeof createProjectsRepo>;
