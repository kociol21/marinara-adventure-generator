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
  `
  CREATE TABLE interview_message (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    role        TEXT NOT NULL,
    content     TEXT NOT NULL,
    questions   TEXT NOT NULL DEFAULT '[]',
    created_at  TEXT NOT NULL
  );
  CREATE INDEX interview_message_project ON interview_message(project_id, id);

  -- One row per saved version; the newest row is the current draft.
  CREATE TABLE requirements (
    project_id    TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    version       INTEGER NOT NULL,
    data          TEXT NOT NULL,
    assumptions   TEXT NOT NULL DEFAULT '[]',
    ready         INTEGER NOT NULL DEFAULT 0,
    approved_at   TEXT,
    created_at    TEXT NOT NULL,
    PRIMARY KEY (project_id, version)
  );

  -- Every model call, for usage display and debugging. No prompts or replies are stored here.
  CREATE TABLE llm_call (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id     TEXT,
    task           TEXT NOT NULL,
    purpose        TEXT NOT NULL,
    connection_id  TEXT,
    model_id       TEXT NOT NULL,
    ok             INTEGER NOT NULL,
    latency_ms     INTEGER NOT NULL,
    error          TEXT,
    created_at     TEXT NOT NULL
  );
  `,
  `
  -- One row per pipeline stage of a project. output holds hidden story content.
  CREATE TABLE stage_run (
    project_id    TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    stage         TEXT NOT NULL,
    status        TEXT NOT NULL,
    input_hash    TEXT,
    output        TEXT,
    output_hash   TEXT,
    summary       TEXT,
    error         TEXT,
    error_detail  TEXT,
    attempts      INTEGER NOT NULL DEFAULT 0,
    started_at    TEXT,
    finished_at   TEXT,
    PRIMARY KEY (project_id, stage)
  );
  `,
];
