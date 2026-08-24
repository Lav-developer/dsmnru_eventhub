// Minimal D1Database adapter backed by node:sqlite.
//
// Lets the integration tests drive the REAL Hono app (real middleware, real
// routes, real PBKDF2) against a real SQLite database built from the actual
// migration files — instead of asserting against a hand-rolled mock.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

function normalize(value: any) {
  if (value === undefined) return null;
  if (value === true) return 1;
  if (value === false) return 0;
  return value;
}

class SqliteStatement {
  constructor(
    private db: DatabaseSync,
    private sql: string,
    private params: any[] = []
  ) {}

  bind(...args: any[]) {
    return new SqliteStatement(this.db, this.sql, args.map(normalize));
  }

  async first<T = any>(colName?: string): Promise<T | null> {
    const stmt = this.db.prepare(this.sql);
    const row: any = stmt.get(...this.params);
    if (row === undefined) return null;
    if (colName) return row[colName] ?? null;
    return row as T;
  }

  async all<T = any>(): Promise<{ results: T[]; success: boolean; meta: any }> {
    const stmt = this.db.prepare(this.sql);
    const rows = stmt.all(...this.params) as T[];
    return { results: rows, success: true, meta: {} };
  }

  async run(): Promise<{ success: boolean; meta: any }> {
    const stmt = this.db.prepare(this.sql);
    const info: any = stmt.run(...this.params);
    return { success: true, meta: { changes: Number(info?.changes ?? 0) } };
  }

  async raw<T = any>(): Promise<T[]> {
    const { results } = await this.all<any>();
    return results.map((r) => Object.values(r)) as T[];
  }
}

export class SqliteD1 {
  readonly db: DatabaseSync;

  constructor() {
    this.db = new DatabaseSync(':memory:');
    this.db.exec('PRAGMA foreign_keys = ON;');
  }

  prepare(sql: string) {
    return new SqliteStatement(this.db, sql);
  }

  async batch(statements: any[]) {
    const out = [];
    for (const st of statements) out.push(await st.run());
    return out;
  }

  async exec(sql: string) {
    this.db.exec(sql);
    return { count: 0, duration: 0 };
  }

  /** Applies every migration file in order, exactly as wrangler would. */
  applyMigrations(migrationsDir = resolve(process.cwd(), 'migrations')) {
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    // NOTE: no error is swallowed here, deliberately.
    //
    // This used to skip "duplicate column name" failures, which made the suite
    // pass while `wrangler d1 migrations apply` was aborting the real chain at
    // 0003 and silently never applying 0004 — the cause of the
    // "no such column: force_password_change" outage. Failing loudly here is
    // what makes a migration that cannot survive a plain wrangler run a test
    // failure instead of a production incident.
    for (const f of files) {
      const sql = readFileSync(resolve(migrationsDir, f), 'utf8');
      try {
        this.db.exec(sql);
      } catch (err: any) {
        throw new Error(
          `Migration ${f} failed: ${err.message}\n` +
            'Every migration must apply cleanly to a fresh database with a plain ' +
            '`wrangler d1 migrations apply` — wrangler aborts the whole chain on the first error.'
        );
      }
    }
  }

  asD1(): D1Database {
    return this as unknown as D1Database;
  }
}
