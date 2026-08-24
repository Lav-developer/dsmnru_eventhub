// Decision logic for reconciling additive schema drift before
// `wrangler d1 migrations apply` runs.
//
// Kept in its own module (no side effects, no wrangler calls) so it can be
// unit tested directly by src/tests/run_tests.ts.

export const PASSWORD_SET_MIGRATION = '0003_add_password_set.sql';

/**
 * Columns that some databases in the wild are missing because an
 * already-applied migration was edited after the fact.
 *
 * SQLite has no "ALTER TABLE ... ADD COLUMN IF NOT EXISTS", so a migration
 * file cannot add these safely: on a database that already has the column the
 * ALTER raises "duplicate column name", and `wrangler d1 migrations apply`
 * aborts the entire chain on the first failure — silently skipping every later
 * migration. The reconciler therefore adds missing columns itself, before
 * handing over to wrangler.
 *
 * Every entry MUST be additive and non-destructive: a nullable column, or a
 * NOT NULL column with a constant DEFAULT. Never put a rebuild here.
 *
 * @type {ReadonlyArray<{table: string, column: string, ddl: string, reason: string}>}
 */
export const RECONCILED_COLUMNS = Object.freeze([
  {
    table: 'users',
    column: 'password_set',
    ddl: 'ALTER TABLE users ADD COLUMN password_set INTEGER NOT NULL DEFAULT 0',
    reason:
      'added to 0001_schema.sql after it had already been applied; 0003 backfills it'
  }
]);

/**
 * Decide what to do about a single reconciled column before migrations run.
 *
 *  - table does not exist yet -> fresh database; the schema migration will
 *                                create the column, so do nothing
 *  - column already present   -> nothing to do
 *  - column missing           -> issue the guarded ALTER
 *
 * @param {{tableExists: boolean, columnExists: boolean}} state
 * @returns {'skip-fresh-database'|'already-present'|'add-column'}
 */
export function planColumnReconcile(state) {
  const { tableExists, columnExists } = state;

  if (!tableExists) return 'skip-fresh-database';
  if (columnExists) return 'already-present';
  return 'add-column';
}

/**
 * Human readable explanation for a column plan, used in CLI output.
 * @param {'skip-fresh-database'|'already-present'|'add-column'} plan
 * @param {{table: string, column: string}} target
 */
export function describeColumnPlan(plan, target) {
  const qualified = `${target.table}.${target.column}`;
  switch (plan) {
    case 'skip-fresh-database':
      return `fresh database (no ${target.table} table yet); migrations will create ${qualified}.`;
    case 'already-present':
      return `${qualified} already exists; nothing to reconcile.`;
    case 'add-column':
      return `${qualified} is MISSING; adding it before migrations run.`;
    default:
      return `Unknown plan: ${plan}`;
  }
}

/**
 * Decide what to do with 0003 before `wrangler d1 migrations apply` runs.
 *
 * 0003 no longer contains DDL — it is a pure, idempotent backfill, so it is
 * always safe to execute. The only reason to mark it applied without running
 * it is that it was already recorded.
 *
 * @param {{usersTableExists: boolean, passwordSetColumnExists: boolean, alreadyRecorded: boolean}} state
 * @returns {'already-recorded'|'run-migration'}
 */
export function planPasswordSetReconcile(state) {
  if (state.alreadyRecorded) return 'already-recorded';
  return 'run-migration';
}

/**
 * Human readable explanation for the chosen plan, used in CLI output.
 * @param {'already-recorded'|'run-migration'} plan
 */
export function describePlan(plan) {
  switch (plan) {
    case 'already-recorded':
      return `${PASSWORD_SET_MIGRATION} is already recorded in d1_migrations; nothing to reconcile.`;
    case 'run-migration':
      return `${PASSWORD_SET_MIGRATION} will run its idempotent password_set backfill.`;
    default:
      return `Unknown plan: ${plan}`;
  }
}
