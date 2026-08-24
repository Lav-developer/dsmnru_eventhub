-- Migration: 0004_force_password_change.sql
--
-- Adds users.force_password_change, which gates the first login of staff
-- accounts provisioned by the role hierarchy (Department Head, Coordinator,
-- Volunteer). Those accounts are created with their email address as the
-- initial password (stored only as a PBKDF2 hash), and must choose a new
-- password before they can reach any authenticated route.
--
-- NOTE: this column is deliberately NOT added to 0001_schema.sql. Editing an
-- already-applied migration is what caused the password_set drift repaired by
-- 0003_add_password_set.sql. Because 0001 never defines this column, a plain
-- ALTER is correct for BOTH fresh and existing databases.

ALTER TABLE users ADD COLUMN force_password_change INTEGER NOT NULL DEFAULT 0;

-- Accounts that never completed password setup are gated on next login.
-- Existing users with password_set = 1 keep force_password_change = 0 and are
-- therefore never forced to change their password.
UPDATE users SET force_password_change = 1 WHERE password_set = 0;
