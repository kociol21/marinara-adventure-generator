import { DatabaseSync } from "node:sqlite";
import { migrations } from "./migrations.ts";

export type Db = DatabaseSync;

/** Opens (or creates) the database and applies pending migrations in one transaction each. */
export function openDatabase(path: string): Db {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

export function migrate(db: Db): void {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  const current = row.user_version;
  if (current > migrations.length) {
    throw new Error(
      `Database schema version ${current} is newer than this app (${migrations.length}). Update the app before opening this data.`,
    );
  }
  for (let version = current; version < migrations.length; version++) {
    transaction(db, () => {
      db.exec(migrations[version]!);
      db.exec(`PRAGMA user_version = ${version + 1}`);
    });
  }
}

export function transaction<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
