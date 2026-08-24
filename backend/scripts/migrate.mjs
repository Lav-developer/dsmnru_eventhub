#!/usr/bin/env node
// Safe D1 migration runner for DSMNRU EventHub.
//
// Wraps `wrangler d1 migrations apply` and reconciles additive schema drift
// before it runs, because SQLite/D1 has no "ALTER TABLE ... ADD COLUMN IF NOT
// EXISTS": a migration that ALTERs a column an existing database already has
// fails with "duplicate column name", and wrangler aborts the entire migration
// chain on the first failure, silently skipping every later migration.
//
// Drift columns are declared in RECONCILED_COLUMNS (migrate-plan.mjs) and added
// here only when genuinely missing. Migration files themselves stay free of
// unguardable DDL so that a plain `wrangler d1 migrations apply` also succeeds.
//
// Usage:
//   npm run db:migrate            # local database
//   npm run db:migrate -- --remote
//   npm run db:migrate -- --local --persist-to .mydir
//
// Any extra flags are forwarded verbatim to wrangler.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  planColumnReconcile,
  describeColumnPlan,
  RECONCILED_COLUMNS
} from './migrate-plan.mjs';

const DB_NAME = 'dsmnru-eventhub-db';

// Resolve the backend project root from this file, so the runner works no
// matter which directory it is invoked from.
const PROJECT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Locate the project's LOCAL wrangler and the argv needed to run it.
 *
 * Never depends on PATH, npx, or a global wrangler install.
 *
 * Windows note: Node refuses to spawn .cmd/.bat files without `shell: true`
 * (CVE-2024-27980 hardening) and fails with EINVAL, which is what broke the
 * previous npx.cmd approach. Enabling `shell: true` would just move the
 * problem — it re-introduces quoting/injection issues for arguments such as
 * --command "<SQL>". So we bypass the shim entirely and run wrangler's Node
 * entrypoint (node_modules/wrangler/bin/wrangler.js) with the current Node
 * binary. That is a plain .js file, so no shell and no .cmd is involved and
 * the exact same code path runs on every platform.
 */
function resolveWrangler() {
  const entry = join(PROJECT_ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  if (existsSync(entry)) {
    return { command: process.execPath, prefix: [entry] };
  }

  // Fallback: the .bin shim, selected per platform as requested. Only reached
  // if the wrangler package layout changes.
  const shim = join(
    PROJECT_ROOT,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler'
  );
  if (existsSync(shim)) {
    // .cmd shims must go through a shell on Windows (see note above).
    return { command: shim, prefix: [], shell: process.platform === 'win32' };
  }

  throw new Error(
    `Could not find the project's local wrangler.\nLooked for:\n  ${entry}\n  ${shim}\nRun \`npm install\` inside ${PROJECT_ROOT} first.`
  );
}

const WRANGLER = resolveWrangler();

const argv = process.argv.slice(2);
const isRemote = argv.includes('--remote');
// Default to --local so a bare `npm run db:migrate` never touches production.
const targetFlags = isRemote ? ['--remote'] : ['--local'];
const passthrough = argv.filter((a) => a !== '--remote' && a !== '--local');

function wrangler(args, { capture = false } = {}) {
  const res = spawnSync(WRANGLER.command, [...WRANGLER.prefix, ...args], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    ...(WRANGLER.shell ? { shell: true } : {})
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

// Columns that must exist on users once every migration has run. Verified as a
// post-condition so a silently skipped migration can never be reported as
// success again.
const REQUIRED_USER_COLUMNS = ['password_set', 'force_password_change'];

function main() {
  console.log(`\n▶ Reconciling schema drift for ${DB_NAME} (${isRemote ? 'remote' : 'local'})…`);

  for (const target of RECONCILED_COLUMNS) {
    const plan = planColumnReconcile({
      tableExists: tableExists(target.table),
      columnExists: columnExists(target.table, target.column)
    });
    console.log(`  ${describeColumnPlan(plan, target)}`);
    if (plan === 'add-column') {
      console.log(`    reason: ${target.reason}`);
      query(target.ddl);
    }
  }

  console.log('\n▶ Applying migrations…');
  const apply = wrangler(['d1', 'migrations', 'apply', DB_NAME, ...targetFlags, ...passthrough]);
  if (apply.status !== 0) process.exit(apply.status ?? 1);

  // Post-condition: every column the application queries MUST exist once
  // migrations report success. `wrangler d1 migrations apply` exits 0 even when
  // it skipped migrations after a failure, so this check is what turns a
  // partially applied chain into a hard error instead of a runtime D1_ERROR.
  console.log('\n▶ Verifying users schema …');
  const info = query(`PRAGMA table_info(users)`);
  const present = new Set(info.map((r) => r.name));
  const missing = REQUIRED_USER_COLUMNS.filter((name) => !present.has(name));

  if (missing.length > 0) {
    console.error(
      `❌ users is STILL missing after migrations: ${missing.join(', ')}. Aborting.\n` +
        '   The migration chain did not fully apply — check the table above for a ❌ row.'
    );
    process.exit(1);
  }

  for (const name of REQUIRED_USER_COLUMNS) {
    const col = info.find((r) => r.name === name);
    console.log(
      `✅ users.${name} present (type=${col.type}, notnull=${col.notnull}, default=${col.dflt_value}).`
    );
  }
}

main();
