import { randomUUID } from "node:crypto";
import {
  portraitSettingsSchema,
  type CreateProjectInput,
  type PortraitSettings,
  type Project,
  type ProjectStatus,
  type UpdateProjectInput,
} from "@adv/shared";
import type { Db } from "../db/database.ts";

interface ProjectRow {
  id: string;
  title: string;
  name: string;
  status: ProjectStatus;
  teaser: string;
  created_at: string;
  updated_at: string;
}

const toProject = (row: ProjectRow): Project => ({
  id: row.id,
  title: row.title,
  name: row.name,
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

    portraits(id: string): PortraitSettings {
      const row = db.prepare("SELECT portraits FROM project WHERE id = ?").get(id) as { portraits: string } | undefined;
      const parsed = portraitSettingsSchema.safeParse(row ? JSON.parse(row.portraits) : {});
      return parsed.success ? parsed.data : portraitSettingsSchema.parse({});
    },

    setPortraits(id: string, settings: PortraitSettings): void {
      db.prepare("UPDATE project SET portraits = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(settings), new Date().toISOString(), id);
    },

    setName(id: string, name: string): void {
      db.prepare("UPDATE project SET name = ?, updated_at = ? WHERE id = ?").run(name, new Date().toISOString(), id);
    },

    /** Titles the player replaced, oldest first. */
    rejectedNames(id: string): string[] {
      const row = db.prepare("SELECT rejected_names FROM project WHERE id = ?").get(id) as { rejected_names: string } | undefined;
      return row ? (JSON.parse(row.rejected_names) as string[]) : [];
    },

    rejectName(id: string, name: string): void {
      const names = [...this.rejectedNames(id).filter((n) => n !== name), name].slice(-20);
      db.prepare("UPDATE project SET rejected_names = ? WHERE id = ?").run(JSON.stringify(names), id);
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
