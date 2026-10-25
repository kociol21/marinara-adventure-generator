/**
 * Ordered schema migrations. Index + 1 is the resulting PRAGMA user_version.
 * Never edit a released migration; append a new one.
 */
export const migrations: string[] = [
  `
  CREATE TABLE project (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'draft',
    teaser      TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE TABLE setting (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
  );

  -- Names of secrets kept in the OS keyring. Values are never stored here.
  CREATE TABLE secret_ref (
    name        TEXT PRIMARY KEY,
    updated_at  TEXT NOT NULL
  );
  `,
];
