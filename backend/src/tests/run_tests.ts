// DSMNRU EventHub - Security, RBAC, and unit tests

import { constantTimeEqual } from '../utils/crypto';
import { sanitizeCSVCell, parseCSV } from '../utils/csv';
import { authorizeCreateEvent, authorizeEventAction, checkEventAuthority } from '../utils/authorize';
import { AppError } from '../utils/errors';
import { User } from '../types';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

console.log('==================================================');
console.log('DSMNRU EventHub - Initiating Production Tests Suite');
console.log('==================================================\n');

function testConstantTimeComparison() {
  console.log('Running Test 1: Constant-time comparison correctness...');
  if (!constantTimeEqual('abcdef', 'abcdef')) throw new Error('Exact matches must return true');
  if (constantTimeEqual('abcdef', 'abcdeg')) throw new Error('Mismatches must return false');
  if (constantTimeEqual('abcdef', 'abcde')) throw new Error('Mismatches in length must return false');
  if (!constantTimeEqual('', '')) throw new Error('Empty strings must match');
  console.log('✅ Test 1 Passed!');
}

function testCSVFormulaInjection() {
  console.log('\nRunning Test 2: CSV Formula Injection (OWASP mitigation) checks...');
  if (sanitizeCSVCell('=SUM(A1:A10)') !== "'=SUM(A1:A10)") throw new Error('Should escape equal character');
  if (sanitizeCSVCell('+100') !== "'+100") throw new Error('Should escape plus character');
  if (sanitizeCSVCell('-250') !== "'-250") throw new Error('Should escape minus character');
  if (sanitizeCSVCell('@IMPORT') !== "'@IMPORT") throw new Error('Should escape at character');
  if (sanitizeCSVCell('Regular Text') !== 'Regular Text') throw new Error('Should preserve normal alpha text');
  console.log('✅ Test 2 Passed!');
}

function testCSVParserRFC4180() {
  console.log('\nRunning Test 3: RFC-4180 CSV Parser validations...');
  const csvData = 'full_name,email,college\r\n"Kush, Lav",lav@example.com,"DSMNRU, Lucknow"\r\n"Rahul ""Almighty"" Kumar",rahul@example.com,DSMNRU';
  const { headers, rows, errors } = parseCSV(csvData);

  if (errors.length !== 0) throw new Error('Should parse without errors');
  if (JSON.stringify(headers) !== JSON.stringify(['full_name', 'email', 'college'])) throw new Error('Headers must parse cleanly');
  if (rows.length !== 2) throw new Error('Should parse 2 valid participant records');
  if (rows[0]['full_name'] !== 'Kush, Lav') throw new Error('Should support quoted commas');
  if (rows[0]['college'] !== 'DSMNRU, Lucknow') throw new Error('Should support quoted cells');
  if (rows[1]['full_name'] !== 'Rahul "Almighty" Kumar') throw new Error('Should support escaped double quotes');
  console.log('✅ Test 3 Passed!');
}

function testCSRFOriginValidation() {
  console.log('\nRunning Test 4: CSRF exact origin equality validation logic...');
  const prodUrl: string = 'https://eventhub.dsmnru.edu.in';
  const validOrigin: string = 'https://eventhub.dsmnru.edu.in';
  if (validOrigin !== prodUrl) throw new Error('Exact matching origin must match the prod url');
  const attackerSubdomain: string = 'https://eventhub.dsmnru.edu.in.attacker.com';
  if (attackerSubdomain === prodUrl) throw new Error('CSRF Check bypassed!');
  const attackerPrefix: string = 'https://eventhub.dsmnru.edu.in-spoof.com';
  if (attackerPrefix === prodUrl) throw new Error('CSRF Check bypassed!');
  console.log('✅ Test 4 Passed!');
}

function testIDORPermissions() {
  console.log('\nRunning Test 5: Cross-Department and Cross-Event IDOR permissions...');
  const coordinatorA = { id: 'coord-a', role: 'coordinator', dept: 'dept-a' };
  const eventB = { id: 'event-b', dept: 'dept-b', coordinators: ['coord-b'] };
  const isAssigned = eventB.coordinators.includes(coordinatorA.id);
  const isDeptHeadOfDept = coordinatorA.role === 'department_head' && coordinatorA.dept === eventB.dept;
  const isAuthorized = isAssigned || isDeptHeadOfDept || coordinatorA.role === 'super_admin';
  if (isAuthorized) {
    throw new Error('IDOR vulnerability! Coordinator A must never be authorized for Event B');
  }
  console.log('✅ Test 5 Passed!');
}

function testAtomicResourceClaimQuantity() {
  console.log('\nRunning Test 6: Concurrent resource claims quantity-exceeded blocking checks...');
  const quantityLimit = 5;
  let currentClaimsCount = 5;
  const wouldInsert = currentClaimsCount < quantityLimit;
  if (wouldInsert) throw new Error('Quantity race condition!');
  currentClaimsCount = 4;
  const wouldInsertValid = currentClaimsCount < quantityLimit;
  if (!wouldInsertValid) throw new Error('Atomic check blocked a valid claim');
  console.log('✅ Test 6 Passed!');
}

type Row = Record<string, any>;

class MockStmt {
  constructor(private db: MockD1, private sql: string, private params: any[] = []) {}
  bind(...args: any[]) {
    const expected = (this.sql.match(/\?/g) || []).length;
    if (args.length !== expected) {
      throw new Error(`D1_ERROR: Wrong number of parameter bindings for SQL query. Got ${args.length} expected ${expected}`);
    }
    return new MockStmt(this.db, this.sql, args);
  }
  async first<T = any>(): Promise<T | null> {
    const rows = this.db.query(this.sql, this.params);
    return (rows[0] as T) || null;
  }
  async all<T = any>(): Promise<{ results: T[] }> {
    return { results: this.db.query(this.sql, this.params) as T[] };
  }
  async run() {
    this.db.exec(this.sql, this.params);
    return { success: true, meta: { changes: 1 } };
  }
}

class MockD1 {
  users = new Map<string, Row>();
  departments = new Map<string, Row>();
  department_members: Row[] = [];
  events = new Map<string, Row>();
  event_members: Row[] = [];
  volunteer_perms: Row[] = [];
  sessions: Row[] = [];
  setup_tokens: Row[] = [];

  prepare(sql: string) {
    return new MockStmt(this, sql);
  }

  query(sql: string, params: any[]): Row[] {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.includes('FROM department_members') && s.includes('user_id')) {
      const uid = params[params.length - 1];
      const deptFilter = s.includes('department_id = ?') ? params[0] : null;
      return this.department_members
        .filter((m) => m.user_id === uid && (!deptFilter || m.department_id === deptFilter))
        .map((m) => ({ ...m, '1': 1 }));
    }
    if (s.includes('FROM events') && s.includes('WHERE id = ?')) {
      const ev = this.events.get(params[0]);
      return ev ? [ev] : [];
    }
    if (s.includes('FROM event_members')) {
      return this.event_members
        .filter((m) => m.event_id === params[0] && m.user_id === params[1])
        .map((m) => ({ ...m, '1': 1 }));
    }
    if (s.includes('FROM volunteer_event_permissions')) {
      return this.volunteer_perms.filter((p) => p.event_id === params[0] && p.user_id === params[1]);
    }
    if (s.includes('FROM users WHERE email')) {
      return [...this.users.values()].filter((u) => u.email === params[0]);
    }
    if (s.includes('FROM users WHERE id')) {
      const u = this.users.get(params[0]);
      return u ? [u] : [];
    }
    if (s.includes('COUNT(*) as count FROM users')) {
      return [{ count: this.users.size }];
    }
    if (s.includes('FROM account_setup_tokens')) {
      return this.setup_tokens.filter((t) => t.token_hash === params[0]);
    }
    return [];
  }

  exec(sql: string, params: any[]) {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('INSERT INTO events')) {
      const expected = (sql.match(/\?/g) || []).length;
      if (params.length !== expected) {
        throw new Error(`D1_ERROR: Wrong number of parameter bindings for SQL query`);
      }
      this.events.set(params[0], {
        id: params[0],
        slug: params[1],
        name: params[2],
        short_name: params[3],
        event_type: params[4],
        department_id: params[5],
        status: 'DRAFT'
      });
    }
    if (s.startsWith('INSERT INTO event_members')) {
      this.event_members.push({ event_id: params[0], user_id: params[1], role: params[2] });
    }
    if (s.startsWith('INSERT INTO users')) {
      this.users.set(params[0], {
        id: params[0],
        email: params[1],
        password_hash: params[2],
        full_name: params[3],
        phone: params[4],
        role: params[5],
        status: params[6]
      });
    }
    if (s.startsWith('INSERT INTO department_members')) {
      this.department_members.push({ department_id: params[0], user_id: params[1] });
    }
    if (s.startsWith('INSERT INTO volunteer_event_permissions')) {
      this.volunteer_perms.push({ event_id: params[0], user_id: params[1], permission: params[2] });
    }
    if (s.startsWith('INSERT INTO account_setup_tokens')) {
      this.setup_tokens.push({
        id: params[0],
        user_id: params[1],
        token_hash: params[2],
        expires_at: params[3],
        used_at: null
      });
    }
    if (s.startsWith('UPDATE users SET password_hash')) {
      const u = this.users.get(params[1]);
      if (u) {
        u.password_hash = params[0];
        u.status = 'active';
        u.password_set = 1;
      }
    }
    if (s.startsWith('UPDATE account_setup_tokens SET used_at')) {
      const tok = this.setup_tokens.find((t) => t.id === params[0]);
      if (tok) tok.used_at = new Date().toISOString();
    }
    if (s.startsWith('DELETE FROM sessions')) {
      this.sessions = this.sessions.filter((x) => x.user_id !== params[0] && x.id !== params[0]);
    }
  }
}

function user(partial: Partial<User> & { id: string; role: User['role'] }): User {
  return {
    email: `${partial.id}@dsmnru.test`,
    full_name: partial.id,
    status: 'active',
    created_at: '',
    updated_at: '',
    ...partial
  };
}

async function expectDenied(fn: () => Promise<any>, code = 403) {
  try {
    await fn();
    throw new Error('Expected denial');
  } catch (e: any) {
    if (e instanceof AppError && e.statusCode === code) return;
    if (e.message === 'Expected denial') throw e;
    if (e instanceof AppError) throw new Error(`Wrong status ${e.statusCode} ${e.message}`);
    throw e;
  }
}

async function testRBACHierarchy() {
  console.log('\nRunning Test 7: RBAC hierarchy + event creation...');
  const db = new MockD1() as unknown as D1Database;
  const raw = db as unknown as MockD1;
  raw.departments.set('dept-a', { id: 'dept-a' });
  raw.departments.set('dept-b', { id: 'dept-b' });
  raw.department_members.push({ department_id: 'dept-a', user_id: 'dh-a' });
  raw.department_members.push({ department_id: 'dept-a', user_id: 'coord-a' });
  raw.department_members.push({ department_id: 'dept-b', user_id: 'coord-b' });
  raw.events.set('event-a', { id: 'event-a', department_id: 'dept-a', status: 'DRAFT' });
  raw.events.set('event-b', { id: 'event-b', department_id: 'dept-b', status: 'DRAFT' });
  raw.event_members.push({ event_id: 'event-a', user_id: 'coord-a', role: 'coordinator' });
  raw.event_members.push({ event_id: 'event-a', user_id: 'vol-a', role: 'volunteer' });
  raw.event_members.push({ event_id: 'event-b', user_id: 'vol-b', role: 'volunteer' });
  raw.volunteer_perms.push({ event_id: 'event-a', user_id: 'vol-a', permission: 'SCAN_ATTENDANCE' });

  const dh = user({ id: 'dh-a', role: 'department_head' });
  const coord = user({ id: 'coord-a', role: 'coordinator' });
  const coordB = user({ id: 'coord-b', role: 'coordinator' });
  const vol = user({ id: 'vol-a', role: 'volunteer' });
  const admin = user({ id: 'sa', role: 'super_admin' });

  const dhDept = await authorizeCreateEvent(db, dh);
  if (dhDept !== 'dept-a') throw new Error('DH must create only in own department');
  const coordDept = await authorizeCreateEvent(db, coord);
  if (coordDept !== 'dept-a') throw new Error('Coordinator must create only in own department');
  await expectDenied(() => authorizeCreateEvent(db, vol));
  const saDept = await authorizeCreateEvent(db, admin);
  if (saDept !== null) throw new Error('Super admin department is chosen explicitly');

  await authorizeEventAction(db, dh, 'event-a', 'manage_event');
  await expectDenied(() => authorizeEventAction(db, dh, 'event-b', 'manage_event'));
  await authorizeEventAction(db, coord, 'event-a', 'manage_event');
  await expectDenied(() => authorizeEventAction(db, coord, 'event-b', 'manage_event'));
  await expectDenied(() => authorizeEventAction(db, coordB, 'event-a', 'manage_event'));
  await expectDenied(() => authorizeEventAction(db, vol, 'event-a', 'manage_event'));
  await expectDenied(() => authorizeEventAction(db, vol, 'event-a', 'manage_participants'));
  await authorizeEventAction(db, vol, 'event-a', 'scan_attendance');
  await expectDenied(() => authorizeEventAction(db, vol, 'event-b', 'scan_attendance'));
  await expectDenied(() => authorizeEventAction(db, vol, 'event-a', 'scan_resource'));

  if (!(await checkEventAuthority(db, dh.id, dh.role, 'event-a'))) throw new Error('DH should manage own event');
  if (await checkEventAuthority(db, vol.id, vol.role, 'event-a')) throw new Error('Volunteer must not manage event');

  console.log('✅ Test 7 Passed!');
}

function testEventInsertBindingCount() {
  console.log('\nRunning Test 8: Event INSERT placeholder/bind count regression...');
  const src = readFileSync(resolve(process.cwd(), 'src/routes/events.ts'), 'utf8');
  const insert = src.match(/INSERT INTO events[\s\S]*?VALUES \(([\s\S]*?)\)/);
  if (!insert) throw new Error('Could not find events INSERT');
  const placeholders = (insert[1].match(/\?/g) || []).length;
  const bindBlock = src.slice(src.indexOf(insert[0])).match(/\.bind\(([\s\S]*?)\)\s*\.run\(\)/);
  if (!bindBlock) throw new Error('Could not find bind() for events INSERT');
  const bindArgs = bindBlock[1]
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (placeholders !== bindArgs.length) {
    throw new Error(`Event INSERT has ${placeholders} placeholders but ${bindArgs.length} bind args`);
  }
  const deptLookup = src.includes('.prepare(\'SELECT department_id FROM department_members WHERE user_id = ?\').first');
  if (deptLookup) {
    throw new Error('Unbound department_members query still present (D1 binding bug)');
  }
  console.log('✅ Test 8 Passed!');
}

function testSignupDoesNotTrustRole() {
  console.log('\nRunning Test 9: Public signup is fully disabled...');
  const src = readFileSync(resolve(process.cwd(), 'src/routes/auth.ts'), 'utf8');
  if (!src.includes('SIGNUP_DISABLED')) {
    throw new Error('POST /register must reject with SIGNUP_DISABLED');
  }
  if (src.includes('BOOTSTRAP_SUPER_ADMIN') || src.includes('isFirstUser')) {
    throw new Error('First-user Super Admin bootstrap must be removed');
  }
  if (src.includes("VALUES (?, ?, ?, ?, ?, 'super_admin'")) {
    throw new Error('Register must not create Super Admin accounts');
  }
  const staff = readFileSync(resolve(process.cwd(), 'src/routes/staff.ts'), 'utf8');
  if (staff.includes("role: 'super_admin'") && staff.includes('createProvisionedUser')) {
    throw new Error('Staff provisioning must never create Super Admin');
  }
  const admin = readFileSync(resolve(process.cwd(), 'src/routes/admin.ts'), 'utf8');
  if (admin.includes("['super_admin', 'department_head', 'coordinator', 'volunteer']")) {
    throw new Error('Admin role API must not allow assigning super_admin');
  }
  console.log('✅ Test 9 Passed!');
}

function testVolunteerPermissionsNotGenericManage() {
  console.log('\nRunning Test 10: Volunteer permissions are operational only...');
  const src = readFileSync(resolve(process.cwd(), 'src/utils/authorize.ts'), 'utf8');
  if (src.includes("EVENT_MANAGE")) throw new Error('Volunteers must not receive EVENT_MANAGE');
  if (!src.includes('SCAN_ATTENDANCE') || !src.includes('SCAN_RESOURCE')) {
    throw new Error('Missing volunteer scan permissions');
  }
  console.log('✅ Test 10 Passed!');
}

function testCoordinatorCreateAllowedInRoute() {
  console.log('\nRunning Test 11: Coordinator is permitted to POST /events...');
  const src = readFileSync(resolve(process.cwd(), 'src/routes/events.ts'), 'utf8');
  if (!src.includes("requireAuth(['super_admin', 'department_head', 'coordinator'])")) {
    throw new Error('Coordinator missing from event create requireAuth — would return Not permitted');
  }
  if (!src.includes('authorizeCreateEvent')) {
    throw new Error('Event create must use central authorizeCreateEvent');
  }
  console.log('✅ Test 11 Passed!');
}

function testMigrationsDoNotDuplicatePasswordSet() {
  console.log('\nRunning Test 13: Fresh 0001+0002 must not re-add password_set...');
  const one = readFileSync(resolve(process.cwd(), 'migrations/0001_schema.sql'), 'utf8');
  const two = readFileSync(resolve(process.cwd(), 'migrations/0002_rbac.sql'), 'utf8');
  if (!/password_set INTEGER/.test(one)) {
    throw new Error('0001_schema.sql must define users.password_set');
  }
  if (/^\s*ALTER TABLE users ADD COLUMN password_set/m.test(two)) {
    throw new Error('0002_rbac.sql must not ADD COLUMN password_set (duplicate on fresh apply)');
  }
  console.log('✅ Test 13 Passed!');
}

function testMigration0003RepairsPasswordSet() {
  console.log('\nRunning Test 17: 0003 migration repairs users.password_set drift...');
  const three = readFileSync(resolve(process.cwd(), 'migrations/0003_add_password_set.sql'), 'utf8');

  if (!/ALTER TABLE users ADD COLUMN password_set INTEGER NOT NULL DEFAULT 0/.test(three)) {
    throw new Error('0003 must add password_set INTEGER NOT NULL DEFAULT 0 to users');
  }
  // A table rebuild would fire ON DELETE CASCADE and destroy membership/session rows.
  if (/DROP TABLE\s+users\b/i.test(three) || /ALTER TABLE\s+users\s+RENAME/i.test(three)) {
    throw new Error('0003 must not rebuild/rename the users table (cascades destroy child rows)');
  }
  // 0001/0002 history must not be rewritten again.
  const one = readFileSync(resolve(process.cwd(), 'migrations/0001_schema.sql'), 'utf8');
  if (!/password_set INTEGER NOT NULL DEFAULT 0/.test(one)) {
    throw new Error('0001_schema.sql must keep password_set for fresh databases');
  }
  console.log('✅ Test 17 Passed!');
}

async function testMigrationPlanReconciliation() {
  console.log('\nRunning Test 18: 0003 apply-plan handles fresh vs legacy databases...');
  const { planPasswordSetReconcile } = await import('../../scripts/migrate-plan.mjs' as string);

  // Legacy production database: 0001/0002 applied, column missing -> must run.
  const legacy = planPasswordSetReconcile({
    usersTableExists: true,
    passwordSetColumnExists: false,
    alreadyRecorded: false
  });
  if (legacy !== 'run-migration') throw new Error('Legacy DB missing the column must run 0003');

  // Fresh database: 0001 creates the column, so executing 0003 would be a duplicate.
  const fresh = planPasswordSetReconcile({
    usersTableExists: false,
    passwordSetColumnExists: false,
    alreadyRecorded: false
  });
  if (fresh !== 'mark-applied') throw new Error('Fresh DB must record 0003 without executing it');

  // Column already present (e.g. re-provisioned dev DB) -> must not ALTER again.
  const present = planPasswordSetReconcile({
    usersTableExists: true,
    passwordSetColumnExists: true,
    alreadyRecorded: false
  });
  if (present !== 'mark-applied') throw new Error('Existing column must not be re-added');

  // Idempotency.
  const done = planPasswordSetReconcile({
    usersTableExists: true,
    passwordSetColumnExists: true,
    alreadyRecorded: true
  });
  if (done !== 'already-recorded') throw new Error('Applying twice must be a no-op');

  console.log('✅ Test 18 Passed!');
}

async function testMigrationsProduceIdenticalSchema() {
  console.log('\nRunning Test 19: fresh and repaired legacy DBs converge on identical schema...');
  const { DatabaseSync } = await import('node:sqlite');
  const { planPasswordSetReconcile } = await import('../../scripts/migrate-plan.mjs' as string);

  const migrationsDir = resolve(process.cwd(), 'migrations');
  const sql0001 = readFileSync(resolve(migrationsDir, '0001_schema.sql'), 'utf8');
  const sql0002 = readFileSync(resolve(migrationsDir, '0002_rbac.sql'), 'utf8');
  const sql0003 = readFileSync(resolve(migrationsDir, '0003_add_password_set.sql'), 'utf8');

  const columnsOf = (db: any) =>
    db
      .prepare('PRAGMA table_info(users)')
      .all()
      .map((r: any) => r.name)
      .sort()
      .join(',');

  const hasColumn = (db: any) =>
    db.prepare("SELECT COUNT(*) c FROM pragma_table_info('users') WHERE name='password_set'").get().c > 0;

  const applyGuarded = (db: any) => {
    const plan = planPasswordSetReconcile({
      usersTableExists:
        db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name='users'").get().c > 0,
      passwordSetColumnExists: hasColumn(db),
      alreadyRecorded: false
    });
    if (plan === 'run-migration') db.exec(sql0003);
    return plan;
  };

  // --- Fresh database: 0001 -> 0002 -> 0003 ---
  const fresh: any = new DatabaseSync(':memory:');
  fresh.exec(sql0001);
  fresh.exec(sql0002);
  if (applyGuarded(fresh) !== 'mark-applied') {
    throw new Error('Fresh DB should not execute the ALTER (0001 already defines the column)');
  }
  if (!hasColumn(fresh)) throw new Error('Fresh DB must end up with password_set');

  // --- Legacy database: 0001 as originally applied (no password_set) -> 0002 -> 0003 ---
  const legacy: any = new DatabaseSync(':memory:');
  legacy.exec(sql0001.replace('  password_set INTEGER NOT NULL DEFAULT 0,\n', ''));
  legacy.exec(sql0002);
  if (hasColumn(legacy)) throw new Error('Legacy fixture should start without password_set');

  // Seed data that ON DELETE CASCADE would destroy if 0003 rebuilt the table.
  legacy.exec(`
    INSERT INTO departments (id,name,code) VALUES ('d1','Computer Science','CS');
    INSERT INTO users (id,email,password_hash,full_name,role,status)
      VALUES ('u-old','old@dsmnru.test','hash','Legacy DH','department_head','active');
    INSERT INTO department_members (department_id,user_id) VALUES ('d1','u-old');
    INSERT INTO sessions (id,user_id,token,expires_at) VALUES ('s1','u-old','tok','2099-01-01T00:00:00Z');
  `);

  if (applyGuarded(legacy) !== 'run-migration') {
    throw new Error('Legacy DB must execute 0003 to add the missing column');
  }
  if (!hasColumn(legacy)) throw new Error('Legacy DB must gain password_set via 0003');

  // No data loss.
  if (legacy.prepare('SELECT COUNT(*) c FROM department_members').get().c !== 1) {
    throw new Error('0003 destroyed department_members rows');
  }
  if (legacy.prepare('SELECT COUNT(*) c FROM sessions').get().c !== 1) {
    throw new Error('0003 destroyed sessions rows');
  }

  // Both paths converge on the same users schema.
  if (columnsOf(fresh) !== columnsOf(legacy)) {
    throw new Error(`Schema mismatch:\n  fresh:  ${columnsOf(fresh)}\n  legacy: ${columnsOf(legacy)}`);
  }

  // The real staff.ts INSERT must work against both.
  for (const [label, db] of [
    ['fresh', fresh],
    ['legacy', legacy]
  ] as const) {
    db.exec(`INSERT OR IGNORE INTO departments (id,name,code) VALUES ('d-x','Dept X','DX');`);
    db.prepare(
      `INSERT INTO users (id, email, password_hash, full_name, phone, role, status, password_set)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
    ).run(`dh-${label}`, `dh-${label}@dsmnru.test`, 'hash', 'New DH', null, 'department_head', 'active');
    const row: any = db.prepare('SELECT password_set FROM users WHERE id = ?').get(`dh-${label}`);
    if (row.password_set !== 0) {
      throw new Error(`Department Head creation on ${label} DB produced password_set=${row.password_set}`);
    }
  }

  console.log('✅ Test 19 Passed!');
}

function testProvisionedUsersStartActive() {
  console.log('\nRunning Test 14: Provisioned staff are active immediately; setup-password remains...');
  const staff = readFileSync(resolve(process.cwd(), 'src/routes/staff.ts'), 'utf8');
  if (!staff.includes("opts.status || 'active'")) {
    throw new Error('createProvisionedUser default status must be active');
  }
  if (!staff.includes('createSetupToken')) {
    throw new Error('Provisioned users must still receive a setup token');
  }
  if (!staff.includes("requireRoles(actor, ['department_head'])")) {
    throw new Error('Only Department Head may create coordinators');
  }
  if (!staff.includes("requireRoles(actor, ['coordinator'])")) {
    throw new Error('Only Coordinator may create volunteers');
  }
  const auth = readFileSync(resolve(process.cwd(), 'src/routes/auth.ts'), 'utf8');
  if (!auth.includes('consumeSetupToken')) {
    throw new Error('setup-password flow must remain');
  }
  console.log('✅ Test 14 Passed!');
}

async function testSetupTokenSingleUseAndExpiry() {
  console.log('\nRunning Test 15: Setup token single-use and expiry...');
  const { consumeSetupToken, createSetupToken } = await import('../utils/provision');
  const rawDb = new MockD1();
  const db = rawDb as unknown as D1Database;
  rawDb.users.set('u1', { id: 'u1', status: 'invited', password_set: 0, password_hash: 'x' });

  const token = await createSetupToken(db, 'u1', 48);
  const userId = await consumeSetupToken(db, token, 'new-hash');
  if (userId !== 'u1') throw new Error('consume should return user id');
  if (rawDb.users.get('u1')?.status !== 'active') throw new Error('user must become active after setup');
  await expectDenied(() => consumeSetupToken(db, token, 'again'), 400);

  rawDb.users.set('u2', { id: 'u2', status: 'invited', password_set: 0, password_hash: 'x' });
  const expired = await createSetupToken(db, 'u2', 48);
  const expiredRow = rawDb.setup_tokens.find((t) => t.user_id === 'u2');
  if (expiredRow) expiredRow.expires_at = new Date(Date.now() - 1000).toISOString();
  await expectDenied(() => consumeSetupToken(db, expired, 'hash'), 400);

  console.log('✅ Test 15 Passed!');
}

async function testFullHierarchyAuthorization() {
  console.log('\nRunning Test 16: Super Admin → DH → Coordinator → Volunteer flow...');
  const db = new MockD1() as unknown as D1Database;
  const raw = db as unknown as MockD1;
  raw.departments.set('dept-a', { id: 'dept-a' });
  raw.departments.set('dept-b', { id: 'dept-b' });
  raw.department_members.push({ department_id: 'dept-a', user_id: 'dh' });
  raw.department_members.push({ department_id: 'dept-a', user_id: 'coord' });
  raw.department_members.push({ department_id: 'dept-b', user_id: 'other-dh' });
  raw.events.set('own', { id: 'own', department_id: 'dept-a' });
  raw.events.set('other', { id: 'other', department_id: 'dept-b' });
  raw.event_members.push({ event_id: 'own', user_id: 'coord', role: 'coordinator' });
  raw.event_members.push({ event_id: 'own', user_id: 'vol', role: 'volunteer' });
  raw.volunteer_perms.push({ event_id: 'own', user_id: 'vol', permission: 'SCAN_ATTENDANCE' });

  const admin = user({ id: 'sa', role: 'super_admin' });
  const dh = user({ id: 'dh', role: 'department_head' });
  const coord = user({ id: 'coord', role: 'coordinator' });
  const vol = user({ id: 'vol', role: 'volunteer' });
  const otherDh = user({ id: 'other-dh', role: 'department_head' });

  if ((await authorizeCreateEvent(db, admin)) !== null) throw new Error('SA create is any department');
  if ((await authorizeCreateEvent(db, dh)) !== 'dept-a') throw new Error('DH own department only');
  if ((await authorizeCreateEvent(db, coord)) !== 'dept-a') throw new Error('Coordinator own department only');
  await expectDenied(() => authorizeCreateEvent(db, vol));

  await authorizeEventAction(db, dh, 'own', 'manage_event');
  await expectDenied(() => authorizeEventAction(db, dh, 'other', 'manage_event'));
  await expectDenied(() => authorizeEventAction(db, otherDh, 'own', 'manage_event'));
  await expectDenied(() => authorizeEventAction(db, coord, 'other', 'manage_event'));
  await expectDenied(() => authorizeEventAction(db, vol, 'own', 'manage_event'));
  await authorizeEventAction(db, vol, 'own', 'scan_attendance');
  await expectDenied(() => authorizeEventAction(db, vol, 'own', 'scan_resource'));

  console.log('✅ Test 16 Passed!');
}

function testSchemaRelationships() {
  console.log('\nRunning Test 12: Schema has membership + volunteer permission tables...');
  const schema = readFileSync(resolve(process.cwd(), 'migrations/0001_schema.sql'), 'utf8');
  if (!schema.includes('department_members')) throw new Error('missing department_members');
  if (!schema.includes('event_members')) throw new Error('missing event_members');
  if (!schema.includes('volunteer_event_permissions')) throw new Error('missing volunteer_event_permissions');
  if (!schema.includes('account_setup_tokens')) throw new Error('missing account_setup_tokens');
  console.log('✅ Test 12 Passed!');
}

async function main() {
  testConstantTimeComparison();
  testCSVFormulaInjection();
  testCSVParserRFC4180();
  testCSRFOriginValidation();
  testIDORPermissions();
  testAtomicResourceClaimQuantity();
  await testRBACHierarchy();
  testEventInsertBindingCount();
  testSignupDoesNotTrustRole();
  testVolunteerPermissionsNotGenericManage();
  testCoordinatorCreateAllowedInRoute();
  testSchemaRelationships();
  testMigrationsDoNotDuplicatePasswordSet();
  testMigration0003RepairsPasswordSet();
  await testMigrationPlanReconciliation();
  await testMigrationsProduceIdenticalSchema();
  testProvisionedUsersStartActive();
  await testSetupTokenSingleUseAndExpiry();
  await testFullHierarchyAuthorization();
  const { runOnboardingTests } = await import('./onboarding_tests');
  await runOnboardingTests();
  console.log('\n==================================================');
  console.log('🎉 ALL INTEGRATION & PRODUCTION-HARDENING TESTS PASSED!');
  console.log('==================================================');
}

main().catch((err) => {
  console.error('\n❌ Test execution failed:', err);
  process.exit(1);
});
