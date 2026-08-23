-- Incremental RBAC objects for databases created before 0001 included them.
-- Fresh installs already create these tables in 0001_schema.sql (IF NOT EXISTS).
-- Do NOT ADD COLUMN password_set here: 0001_schema.sql already defines it.

CREATE TABLE IF NOT EXISTS account_setup_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_setup_tokens_user ON account_setup_tokens(user_id);

CREATE TABLE IF NOT EXISTS volunteer_event_permissions (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL CHECK(permission IN ('SCAN_ATTENDANCE', 'SCAN_RESOURCE')),
  PRIMARY KEY (event_id, user_id, permission)
);

CREATE INDEX IF NOT EXISTS idx_dept_members_user ON department_members(user_id);
CREATE INDEX IF NOT EXISTS idx_event_members_user ON event_members(user_id);
