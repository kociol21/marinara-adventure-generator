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
  `
  CREATE TABLE connection (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL,
    base_url    TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE TABLE model_catalog (
    connection_id    TEXT NOT NULL REFERENCES connection(id) ON DELETE CASCADE,
    capability       TEXT NOT NULL,
    model_id         TEXT NOT NULL,
    name             TEXT NOT NULL,
    source           TEXT NOT NULL,
    billing          TEXT NOT NULL,
    quota_multiplier REAL,
    context_length   INTEGER,
    fetched_at       TEXT NOT NULL,
    PRIMARY KEY (connection_id, capability, model_id)
  );

  CREATE TABLE task_assignment (
    task           TEXT PRIMARY KEY,
    connection_id  TEXT NOT NULL REFERENCES connection(id) ON DELETE CASCADE,
    model_id       TEXT NOT NULL
  );
  `,
];
