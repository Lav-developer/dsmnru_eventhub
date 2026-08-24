// Decision logic for applying 0003_add_password_set.sql safely.
//
// Kept in its own module (no side effects, no wrangler calls) so it can be
// unit tested directly by src/tests/run_tests.ts.

export const PASSWORD_SET_MIGRATION = '0003_add_password_set.sql';

/**
 * Decide what to do with 0003 before `wrangler d1 migrations apply` runs.
 *
 * SQLite has no "ADD COLUMN IF NOT EXISTS", so the migration file itself
 * cannot be conditional. We reconcile beforehand instead:
 *
 *  - already recorded            -> nothing to do
 *  - users table does not exist  -> fresh database; 0001 will create the column,
 *                                   so record 0003 as applied without running it
 *  - column already present      -> record 0003 as applied without running it
 *  - column missing              -> let wrangler execute the ALTER
 *
 * @param {{usersTableExists: boolean, passwordSetColumnExists: boolean, alreadyRecorded: boolean}} state
 * @returns {'already-recorded'|'mark-applied'|'run-migration'}
 */
export function planPasswordSetReconcile(state) {
  const { usersTableExists, passwordSetColumnExists, alreadyRecorded } = state;

  if (alreadyRecorded) return 'already-recorded';
  if (!usersTableExists) return 'mark-applied';
  if (passwordSetColumnExists) return 'mark-applied';
  return 'run-migration';
}

/**
 * Human readable explanation for the chosen plan, used in CLI output.
 * @param {'already-recorded'|'mark-applied'|'run-migration'} plan
 * @param {{usersTableExists: boolean, passwordSetColumnExists: boolean}} state
 */
export function describePlan(plan, state) {
  switch (plan) {
    case 'already-recorded':
      return `${PASSWORD_SET_MIGRATION} is already recorded in d1_migrations; nothing to reconcile.`;
    case 'mark-applied':
      return state.usersTableExists
        ? `users.password_set already exists; recording ${PASSWORD_SET_MIGRATION} as applied without executing it.`
        : `fresh database (no users table yet); 0001 will create password_set, so ${PASSWORD_SET_MIGRATION} is recorded as applied without executing it.`;
    case 'run-migration':
      return `users.password_set is MISSING; ${PASSWORD_SET_MIGRATION} will be executed to add it.`;
    default:
      return `Unknown plan: ${plan}`;
  }
}
