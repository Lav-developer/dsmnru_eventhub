-- Migration: 0003_add_password_set.sql
--
-- PURPOSE
-- Repairs schema drift introduced when 0001_schema.sql was edited to include
-- users.password_set *after* it had already been applied. Databases created
-- before that edit report 0001/0002 as applied in d1_migrations, yet their
-- users table has no password_set column, so every staff INSERT (Department
-- Head / Coordinator / Volunteer creation) fails with "no such column".
--
-- WHY THIS FILE IS A PLAIN ALTER
-- SQLite (and therefore D1) has no "ALTER TABLE ... ADD COLUMN IF NOT EXISTS",
-- so this statement cannot guard itself. A table rebuild is deliberately NOT
-- used: dropping or renaming `users` fires ON DELETE CASCADE and would destroy
-- department_members, event_members, sessions and account_setup_tokens rows.
-- D1 cannot turn foreign keys off (only PRAGMA defer_foreign_keys, which does
-- not stop cascades), so a rebuild is data-destructive by construction.
--
-- HOW IT IS APPLIED SAFELY
-- This migration must only execute against databases that are actually missing
-- the column. `npm run db:migrate` (scripts/migrate.mjs) enforces that:
--   * legacy database (column missing) -> this file runs and adds the column
--   * fresh database  (0001 creates it) -> this file is recorded as applied
--                                          without being executed
-- Both paths end with the same schema, and 0001/0002 history is never rewritten.
--
-- Use `npm run db:migrate` instead of a bare `wrangler d1 migrations apply`.

ALTER TABLE users ADD COLUMN password_set INTEGER NOT NULL DEFAULT 0;

-- Backfill: accounts that pre-date the provisioning flow never received an
-- account setup token, which means they already chose their own password.
-- Newly provisioned accounts always have a setup token and correctly stay at 0
-- until /auth/setup-password completes.
UPDATE users
SET password_set = 1
WHERE id NOT IN (SELECT user_id FROM account_setup_tokens);
