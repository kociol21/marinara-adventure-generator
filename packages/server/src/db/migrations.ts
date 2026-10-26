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
  `
  -- Fix notes from the quality audit, fed into the next run of their stage. basis = hash of the
  -- approved requirements they were written against; notes for older requirements are ignored.
  CREATE TABLE stage_note (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    basis       TEXT NOT NULL,
    stage       TEXT NOT NULL,
    round       INTEGER NOT NULL,
    note        TEXT NOT NULL,
    created_at  TEXT NOT NULL
  );
  CREATE INDEX stage_note_project ON stage_note(project_id, basis);
  `,
  `
  -- Input hash without audit notes: equal base hashes mean only notes changed, so a rerun can
  -- edit the previous output instead of starting over.
  ALTER TABLE stage_run ADD COLUMN base_hash TEXT;

  -- Fix rounds count from here; a new fix session keeps earlier notes but allows new rounds.
  CREATE TABLE audit_session (
    project_id   TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    basis        TEXT NOT NULL,
    after_round  INTEGER NOT NULL,
    PRIMARY KEY (project_id, basis)
  );
  `,
  `
  -- Portrait settings (style, notes, on/off) as JSON; kept apart from the requirements.
  ALTER TABLE project ADD COLUMN portraits TEXT NOT NULL DEFAULT '{}';
  `,
  `
  -- Push to Marinara history: ids, counts and statuses (JSON), never story text.
  CREATE TABLE marinara_push (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    pushed_at   TEXT NOT NULL,
    record      TEXT NOT NULL
  );
  CREATE INDEX marinara_push_project ON marinara_push(project_id, pushed_at);
  `,
  `
  -- Decision-model judge: counts per fix round (no story text), and the best-scored output of
  -- each judged stage, restored when a later rewrite scores clearly worse. output is hidden content.
  CREATE TABLE judge_round (
    project_id  TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    basis       TEXT NOT NULL,
    round       INTEGER NOT NULL,
    result      TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    PRIMARY KEY (project_id, basis, round)
  );
  CREATE TABLE judge_best (
    project_id   TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    basis        TEXT NOT NULL,
    stage        TEXT NOT NULL,
    base_hash    TEXT,
    score        REAL NOT NULL,
    output       TEXT NOT NULL,
    output_hash  TEXT NOT NULL,
    summary      TEXT,
    restored     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (project_id, basis, stage)
  );
  `,
  `
  -- The adventure's own title, written by the title stage ('' until then), and titles the player
  -- asked to replace, so a regenerated title does not repeat them.
  ALTER TABLE project ADD COLUMN name TEXT NOT NULL DEFAULT '';
  ALTER TABLE project ADD COLUMN rejected_names TEXT NOT NULL DEFAULT '[]';
  `,
  `
  -- Usage and cost per request. Prices are USD per million tokens from the provider's catalog;
  -- cost_usd and billing are fixed when the call is made. estimated = token counts guessed from
  -- the request size because the provider reported none.
  ALTER TABLE model_catalog ADD COLUMN price_in REAL;
  ALTER TABLE model_catalog ADD COLUMN price_out REAL;
  ALTER TABLE llm_call ADD COLUMN input_tokens INTEGER;
  ALTER TABLE llm_call ADD COLUMN output_tokens INTEGER;
  ALTER TABLE llm_call ADD COLUMN cost_usd REAL;
  ALTER TABLE llm_call ADD COLUMN billing TEXT;
  ALTER TABLE llm_call ADD COLUMN quota_tokens INTEGER;
  ALTER TABLE llm_call ADD COLUMN estimated INTEGER NOT NULL DEFAULT 0;
  `,
  `
  -- The player's own change requests for a stage ("make the opening funnier"). Written without
  -- seeing the story; they join the stage's hash like audit notes and survive new fix sessions.
  CREATE TABLE player_note (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    stage       TEXT NOT NULL,
    note        TEXT NOT NULL,
    created_at  TEXT NOT NULL
  );
  CREATE INDEX player_note_project ON player_note(project_id);
  `,
];
