-- Migration: 0003_add_password_set.sql
--
-- PURPOSE
-- Repairs schema drift introduced when 0001_schema.sql was edited to include
-- users.password_set *after* it had already been applied. Databases created
-- before that edit report 0001/0002 as applied in d1_migrations, yet their
-- users table has no password_set column.
--
-- WHY THIS FILE NO LONGER CONTAINS THE "ALTER TABLE ... ADD COLUMN"
-- SQLite (and therefore D1) has no "ADD COLUMN IF NOT EXISTS", so an ALTER in
-- this file cannot guard itself. On a FRESH database 0001 already creates
-- password_set, so the ALTER raised
--
--     duplicate column name: password_set: SQLITE_ERROR
--
-- and `wrangler d1 migrations apply` aborts the whole chain on the first
-- failure. That silently prevented 0004_force_password_change.sql from ever
-- running, which is what produced "D1_ERROR: no such column:
-- force_password_change" at runtime. A migration that cannot survive a plain
-- `wrangler d1 migrations apply` is a trap, so the conditional DDL now lives in
-- scripts/migrate.mjs, which can inspect the schema before deciding.
--
-- Adding the column is therefore handled by `npm run db:migrate`:
--   * legacy database (column missing) -> the reconciler issues the ALTER
--                                         before wrangler runs
--   * fresh database  (0001 creates it) -> nothing to do
-- In both cases this file then runs the idempotent backfill below.
--
-- A table rebuild is deliberately NOT used: dropping or renaming `users` fires
-- ON DELETE CASCADE and would destroy department_members, event_members,
-- sessions and account_setup_tokens rows. D1 cannot turn foreign keys off
-- (only PRAGMA defer_foreign_keys, which does not stop cascades), so a rebuild
-- is data-destructive by construction.

-- Backfill: accounts that pre-date the provisioning flow never received an
-- account setup token, which means they already chose their own password.
-- Newly provisioned accounts always have a setup token and correctly stay at 0
-- until /auth/setup-password completes.
--
-- Idempotent: re-running it cannot demote an account back to 0.
UPDATE users
SET password_set = 1
WHERE password_set = 0
  AND id NOT IN (SELECT user_id FROM account_setup_tokens);
