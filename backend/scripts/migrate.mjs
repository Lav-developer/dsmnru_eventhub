#!/usr/bin/env node
// Safe D1 migration runner for DSMNRU EventHub.
//
// Wraps `wrangler d1 migrations apply` and reconciles 0003_add_password_set.sql
// before it runs, because SQLite/D1 has no "ALTER TABLE ... ADD COLUMN IF NOT
// EXISTS" and 0001_schema.sql already creates the column on fresh databases.
//
// Usage:
//   npm run db:migrate            # local database
//   npm run db:migrate -- --remote
//   npm run db:migrate -- --local --persist-to .mydir
//
// Any extra flags are forwarded verbatim to wrangler.

import { spawnSync } from 'node:child_process';
import { planPasswordSetReconcile, describePlan, PASSWORD_SET_MIGRATION } from './migrate-plan.mjs';

const DB_NAME = 'dsmnru-eventhub-db';
const MIGRATIONS_TABLE = 'd1_migrations';

// On Windows, `npx` is a .cmd shim and is not directly executable by
// spawnSync, which fails with ENOENT. Use npx.cmd there.
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const argv = process.argv.slice(2);
const isRemote = argv.includes('--remote');
// Default to --local so a bare `npm run db:migrate` never touches production.
const targetFlags = isRemote ? ['--remote'] : ['--local'];
const passthrough = argv.filter((a) => a !== '--remote' && a !== '--local');

function wrangler(args, { capture = false } = {}) {
  const res = spawnSync(npxCommand, ['wrangler', ...args], {
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }
  });
  if (res.error) throw res.error;
  return res;
}

function query(sql) {
  const res = wrangler(
    ['d1', 'execute', DB_NAME, ...targetFlags, ...passthrough, '--json', '--command', sql],
    { capture: true }
  );
  if (res.status !== 0) {
    throw new Error(`Query failed: ${sql}\n${res.stderr || res.stdout}`);
  }
  // Wrangler prints a banner before the JSON payload; slice from the first bracket.
  const out = res.stdout;
  const start = out.indexOf('[');
  if (start === -1) throw new Error(`Unexpected wrangler output for: ${sql}\n${out}`);
  const parsed = JSON.parse(out.slice(start));
  return parsed[0]?.results ?? [];
}

function tableExists(name) {
  const rows = query(
    `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='${name}'`
  );
  return Number(rows[0]?.c ?? 0) > 0;
}

function columnExists(table, column) {
  if (!tableExists(table)) return false;
  const rows = query(
    `SELECT COUNT(*) AS c FROM pragma_table_info('${table}') WHERE name='${column}'`
  );
  return Number(rows[0]?.c ?? 0) > 0;
}

function migrationRecorded(name) {
  if (!tableExists(MIGRATIONS_TABLE)) return false;
  const rows = query(`SELECT COUNT(*) AS c FROM ${MIGRATIONS_TABLE} WHERE name='${name}'`);
  return Number(rows[0]?.c ?? 0) > 0;
}

function main() {
  console.log(`\n▶ Reconciling schema drift for ${DB_NAME} (${isRemote ? 'remote' : 'local'})…`);

  const state = {
    usersTableExists: tableExists('users'),
    passwordSetColumnExists: columnExists('users', 'password_set'),
    alreadyRecorded: migrationRecorded(PASSWORD_SET_MIGRATION)
  };

  const plan = planPasswordSetReconcile(state);
  console.log(`  ${describePlan(plan, state)}`);

  if (plan === 'mark-applied') {
    // Ensure the migrations table exists before inserting into it. Wrangler
    // creates it with this exact shape.
    query(
      `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE}(
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         name TEXT UNIQUE,
         applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
       )`
    );
    query(`INSERT OR IGNORE INTO ${MIGRATIONS_TABLE} (name) VALUES ('${PASSWORD_SET_MIGRATION}')`);
  }

  console.log('\n▶ Applying migrations…');
  const apply = wrangler(['d1', 'migrations', 'apply', DB_NAME, ...targetFlags, ...passthrough]);
  if (apply.status !== 0) process.exit(apply.status ?? 1);

  // Post-condition: the column MUST exist once migrations report success.
  const finalHasColumn = columnExists('users', 'password_set');
  console.log('\n▶ Verifying users.password_set …');
  if (!finalHasColumn) {
    console.error('❌ users.password_set is STILL missing after migrations. Aborting.');
    process.exit(1);
  }
  const info = query(`PRAGMA table_info(users)`);
  const col = info.find((r) => r.name === 'password_set');
  console.log(
    `✅ users.password_set present (type=${col.type}, notnull=${col.notnull}, default=${col.dflt_value}).`
  );
}

main();
