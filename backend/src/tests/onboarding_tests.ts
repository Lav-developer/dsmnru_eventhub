// Integration tests for staff onboarding: email-as-password first login,
// forced password change, and volunteer management.
//
// These drive the REAL Hono app (real middleware, real routes, real PBKDF2)
// against a real SQLite database built from the actual migration files.

import app from '../index';
import { SqliteD1 } from './d1_sqlite';
import { hashPassword } from '../utils/crypto';

const ORIGIN = 'http://localhost:5173';

export interface Ctx {
  d1: SqliteD1;
  env: any;
}

export function freshDb(): Ctx {
  const d1 = new SqliteD1();
  d1.applyMigrations();
  return { d1, env: { DB: d1.asD1(), ENV: 'development' } };
}

/** Issues a request against the real app, carrying a session cookie if given. */
export async function call(
  ctx: Ctx,
  path: string,
  init: { method?: string; body?: any; cookie?: string } = {}
): Promise<{ status: number; body: any; cookie: string | null }> {
  const headers: Record<string, string> = { Origin: ORIGIN };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.cookie) headers['Cookie'] = init.cookie;

  const res = await app.fetch(
    new Request(`http://localhost${path}`, {
      method: init.method || 'GET',
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined
    }),
    ctx.env,
    { waitUntil: () => {}, passThroughOnException: () => {} } as any
  );

  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  const setCookie = res.headers.get('Set-Cookie');
  let cookie: string | null = null;
  if (setCookie) {
    const m = setCookie.match(/session_token=([^;]*)/);
    if (m && m[1]) cookie = `session_token=${m[1]}`;
  }
  return { status: res.status, body, cookie };
}

export function seedDepartment(ctx: Ctx, id = 'dept-cs', name = 'Computer Science', code = 'CS') {
  ctx.d1.db
    .prepare('INSERT INTO departments (id, name, code) VALUES (?, ?, ?)')
    .run(id, name, code);
  return id;
}

/** Creates an already-onboarded user (password_set=1, no forced change). */
export async function seedActiveUser(
  ctx: Ctx,
  opts: { id: string; email: string; role: string; password: string; departmentId?: string }
) {
  const hash = await hashPassword(opts.password);
  ctx.d1.db
    .prepare(
      `INSERT INTO users (id, email, password_hash, full_name, role, status, password_set, force_password_change)
       VALUES (?, ?, ?, ?, ?, 'active', 1, 0)`
    )
    .run(opts.id, opts.email.toLowerCase(), hash, opts.id, opts.role);
  if (opts.departmentId) {
    ctx.d1.db
      .prepare('INSERT INTO department_members (department_id, user_id) VALUES (?, ?)')
      .run(opts.departmentId, opts.id);
  }
  return opts.id;
}

export function seedEvent(ctx: Ctx, id: string, departmentId: string) {
  ctx.d1.db
    .prepare(
      `INSERT INTO events (id, slug, name, short_name, event_type, department_id, start_date, end_date,
        start_time, end_time, venue, format, registration_type, status)
       VALUES (?, ?, ?, ?, 'seminar', ?, '2026-01-01', '2026-01-02', '10:00', '17:00', 'Hall', 'offline', 'built_in', 'PUBLISHED')`
    )
    .run(id, id, `Event ${id}`, id, departmentId);
  return id;
}

export function assign(ctx: Ctx, eventId: string, userId: string, role: string) {
  ctx.d1.db
    .prepare('INSERT INTO event_members (event_id, user_id, role) VALUES (?, ?, ?)')
    .run(eventId, userId, role);
}

function userRow(ctx: Ctx, email: string): any {
  return ctx.d1.db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
}

async function loginAs(ctx: Ctx, email: string, password: string) {
  return call(ctx, '/api/v1/auth/login', { method: 'POST', body: { email, password } });
}

/** Super Admin -> Department Head -> Coordinator chain, all fully onboarded. */
async function buildHierarchy(ctx: Ctx) {
  const dept = seedDepartment(ctx);
  await seedActiveUser(ctx, { id: 'sa', email: 'sa@dsmnru.test', role: 'super_admin', password: 'SuperSecret123' });
  await seedActiveUser(ctx, {
    id: 'dh',
    email: 'dh@dsmnru.test',
    role: 'department_head',
    password: 'HeadSecret123',
    departmentId: dept
  });
  await seedActiveUser(ctx, {
    id: 'coord',
    email: 'coord@dsmnru.test',
    role: 'coordinator',
    password: 'CoordSecret123',
    departmentId: dept
  });
  return dept;
}

// ---------------------------------------------------------------------------
// 1. New user gets password_set = 0 / force_password_change = 1
// ---------------------------------------------------------------------------
async function testNewUserFlags() {
  console.log('\nRunning Onboarding Test 1: new staff get password_set=0 / force_password_change=1...');
  const ctx = freshDb();
  const dept = await buildHierarchy(ctx);

  const sa = await loginAs(ctx, 'sa@dsmnru.test', 'SuperSecret123');
  if (sa.status !== 200) throw new Error('Super Admin login should succeed');

  const created = await call(ctx, '/api/v1/staff/department-heads', {
    method: 'POST',
    cookie: sa.cookie!,
    body: { email: 'NewHead@dsmnru.test', full_name: 'New Head', department_id: dept }
  });
  if (created.status !== 200) throw new Error(`DH creation failed: ${JSON.stringify(created.body)}`);

  const row = userRow(ctx, 'newhead@dsmnru.test');
  if (!row) throw new Error('Department Head was not created');
  if (row.password_set !== 0) throw new Error(`password_set must be 0, got ${row.password_set}`);
  if (row.force_password_change !== 1) {
    throw new Error(`force_password_change must be 1, got ${row.force_password_change}`);
  }
  // Plaintext must never be stored.
  if (String(row.password_hash).includes('newhead@dsmnru.test')) {
    throw new Error('Plaintext email-as-password must never be stored');
  }
  if (!String(row.password_hash).startsWith('pbkdf2_sha256$')) {
    throw new Error('Password must be stored as a PBKDF2 hash');
  }
  console.log('✅ Onboarding Test 1 Passed!');
}

// ---------------------------------------------------------------------------
// 2 + 3. First login with email-as-password succeeds, but cannot reach dashboards
// ---------------------------------------------------------------------------
async function testFirstLoginGated() {
  console.log('\nRunning Onboarding Test 2+3: first login works but dashboard APIs are blocked...');
  const ctx = freshDb();
  const dept = await buildHierarchy(ctx);
  const sa = await loginAs(ctx, 'sa@dsmnru.test', 'SuperSecret123');
  await call(ctx, '/api/v1/staff/department-heads', {
    method: 'POST',
    cookie: sa.cookie!,
    body: { email: 'head2@dsmnru.test', full_name: 'Head Two', department_id: dept }
  });

  // 2. email-as-password works for the first login
  const first = await loginAs(ctx, 'head2@dsmnru.test', 'head2@dsmnru.test');
  if (first.status !== 200) throw new Error('First login with email-as-password must succeed');
  if (first.body?.data?.force_password_change !== true) {
    throw new Error('Login response must report force_password_change = true');
  }
  if (!first.cookie) throw new Error('First login must still establish a session');

  // 3. that session cannot reach normal authenticated APIs
  const blocked = [
    { path: '/api/v1/events', method: 'POST' },
    { path: '/api/v1/staff/coordinators', method: 'POST' },
    { path: '/api/v1/departments', method: 'POST' },
    { path: '/api/v1/staff/coordinators', method: 'GET' }
  ];
  for (const b of blocked) {
    const res = await call(ctx, b.path, {
      method: b.method,
      cookie: first.cookie!,
      body: b.method === 'POST' ? {} : undefined
    });
    if (res.status !== 403 || res.body?.error?.code !== 'PASSWORD_CHANGE_REQUIRED') {
      throw new Error(
        `${b.method} ${b.path} must be blocked with PASSWORD_CHANGE_REQUIRED, got ${res.status} ${JSON.stringify(res.body?.error)}`
      );
    }
  }

  // /auth/me stays reachable so the client can discover the gate.
  const me = await call(ctx, '/api/v1/auth/me', { cookie: first.cookie! });
  if (me.status !== 200 || me.body?.data?.force_password_change !== true) {
    throw new Error('/auth/me must remain reachable and report the gate');
  }
  console.log('✅ Onboarding Test 2+3 Passed!');
}

// ---------------------------------------------------------------------------
// 4 + 5 + 6. Change password; old email-password dies; new password works
// ---------------------------------------------------------------------------
async function testPasswordChangeLifecycle() {
  console.log('\nRunning Onboarding Test 4+5+6: change password, old credential dies, new one works...');
  const ctx = freshDb();
  const dept = await buildHierarchy(ctx);
  const sa = await loginAs(ctx, 'sa@dsmnru.test', 'SuperSecret123');
  await call(ctx, '/api/v1/staff/department-heads', {
    method: 'POST',
    cookie: sa.cookie!,
    body: { email: 'head3@dsmnru.test', full_name: 'Head Three', department_id: dept }
  });

  const first = await loginAs(ctx, 'head3@dsmnru.test', 'head3@dsmnru.test');
  const firstCookie = first.cookie!;

  // Cannot set the new password to the email again.
  const sameAsEmail = await call(ctx, '/api/v1/auth/change-password', {
    method: 'POST',
    cookie: firstCookie,
    body: { current_password: 'head3@dsmnru.test', new_password: 'head3@dsmnru.test' }
  });
  if (sameAsEmail.status !== 400) throw new Error('New password must not be allowed to equal the email');

  // Wrong current password is rejected.
  const wrong = await call(ctx, '/api/v1/auth/change-password', {
    method: 'POST',
    cookie: firstCookie,
    body: { current_password: 'not-it', new_password: 'BrandNewPass123' }
  });
  if (wrong.status !== 401) throw new Error('Wrong current password must be rejected');

  // 4. Successful change.
  const changed = await call(ctx, '/api/v1/auth/change-password', {
    method: 'POST',
    cookie: firstCookie,
    body: { current_password: 'head3@dsmnru.test', new_password: 'BrandNewPass123' }
  });
  if (changed.status !== 200) throw new Error(`Password change failed: ${JSON.stringify(changed.body)}`);
  if (!changed.cookie || changed.cookie === firstCookie) {
    throw new Error('A fresh session must be issued after the password change');
  }

  const row = userRow(ctx, 'head3@dsmnru.test');
  if (row.password_set !== 1) throw new Error('password_set must become 1');
  if (row.force_password_change !== 0) throw new Error('force_password_change must become 0');

  // The old first-login session must be dead.
  const oldSession = await call(ctx, '/api/v1/staff/coordinators', { cookie: firstCookie });
  if (oldSession.status !== 401) {
    throw new Error(`Old first-login session must be invalidated, got ${oldSession.status}`);
  }

  // The new session works for normal APIs.
  const withNew = await call(ctx, '/api/v1/staff/coordinators', { cookie: changed.cookie! });
  if (withNew.status !== 200) {
    throw new Error(`New session must reach normal APIs, got ${withNew.status}`);
  }

  // 5. Initial email-as-password no longer works.
  const reuse = await loginAs(ctx, 'head3@dsmnru.test', 'head3@dsmnru.test');
  if (reuse.status === 200) throw new Error('Initial email-as-password must stop working');

  // 6. New password works normally, with no gate.
  const relogin = await loginAs(ctx, 'head3@dsmnru.test', 'BrandNewPass123');
  if (relogin.status !== 200) throw new Error('New password must work');
  if (relogin.body?.data?.force_password_change !== false) {
    throw new Error('force_password_change must be false after the change');
  }
  const dash = await call(ctx, '/api/v1/staff/coordinators', { cookie: relogin.cookie! });
  if (dash.status !== 200) throw new Error('Normal login must reach the dashboard APIs');

  console.log('✅ Onboarding Test 4+5+6 Passed!');
}

// ---------------------------------------------------------------------------
// 7. Existing password_set = 1 users are unaffected
// ---------------------------------------------------------------------------
async function testExistingUsersUnaffected() {
  console.log('\nRunning Onboarding Test 7: existing password_set=1 users are never forced...');
  const ctx = freshDb();
  await buildHierarchy(ctx);

  const login = await loginAs(ctx, 'dh@dsmnru.test', 'HeadSecret123');
  if (login.status !== 200) throw new Error('Existing user login must succeed');
  if (login.body?.data?.force_password_change !== false) {
    throw new Error('Existing user must not be forced to change password');
  }
  const res = await call(ctx, '/api/v1/staff/coordinators', { cookie: login.cookie! });
  if (res.status !== 200) throw new Error('Existing user must reach dashboard APIs immediately');

  // Their email must NOT work as a password.
  const emailAsPassword = await loginAs(ctx, 'dh@dsmnru.test', 'dh@dsmnru.test');
  if (emailAsPassword.status === 200) {
    throw new Error('Email-as-password must never work for an already-onboarded user');
  }
  console.log('✅ Onboarding Test 7 Passed!');
}

// ---------------------------------------------------------------------------
// 8 + 9. Coordinator creates a volunteer with only scanner permissions
// ---------------------------------------------------------------------------
async function testCoordinatorCreatesVolunteer() {
  console.log('\nRunning Onboarding Test 8+9: coordinator adds a volunteer with scanner permissions...');
  const ctx = freshDb();
  const dept = await buildHierarchy(ctx);
  const ev = seedEvent(ctx, 'ev-1', dept);
  assign(ctx, ev, 'coord', 'coordinator');

  const coord = await loginAs(ctx, 'coord@dsmnru.test', 'CoordSecret123');
  if (coord.status !== 200) throw new Error('Coordinator login failed');

  const res = await call(ctx, '/api/v1/staff/volunteers', {
    method: 'POST',
    cookie: coord.cookie!,
    body: {
      email: 'vol@dsmnru.test',
      full_name: 'Vol One',
      event_id: ev,
      permissions: ['SCAN_ATTENDANCE', 'SCAN_RESOURCE']
    }
  });
  if (res.status !== 200) throw new Error(`Volunteer creation failed: ${JSON.stringify(res.body)}`);

  const vol = userRow(ctx, 'vol@dsmnru.test');
  if (!vol) throw new Error('Volunteer not created');
  if (vol.role !== 'volunteer') throw new Error('Created user must have the volunteer role');
  if (vol.password_set !== 0 || vol.force_password_change !== 1) {
    throw new Error('Volunteer must also start gated with email-as-password');
  }

  // 9. Only the granted scanner permissions exist.
  const perms = ctx.d1.db
    .prepare('SELECT permission FROM volunteer_event_permissions WHERE event_id = ? AND user_id = ? ORDER BY permission')
    .all(ev, vol.id)
    .map((r: any) => r.permission);
  if (JSON.stringify(perms) !== JSON.stringify(['SCAN_ATTENDANCE', 'SCAN_RESOURCE'])) {
    throw new Error(`Unexpected volunteer permissions: ${JSON.stringify(perms)}`);
  }

  // A coordinator cannot add volunteers to an event they do not manage.
  const otherDept = seedDepartment(ctx, 'dept-eee', 'Electrical', 'EEE');
  const otherEvent = seedEvent(ctx, 'ev-other', otherDept);
  const denied = await call(ctx, '/api/v1/staff/volunteers', {
    method: 'POST',
    cookie: coord.cookie!,
    body: { email: 'vol2@dsmnru.test', full_name: 'Vol Two', event_id: otherEvent }
  });
  if (denied.status !== 403) {
    throw new Error(`Coordinator must not add volunteers to unmanaged events, got ${denied.status}`);
  }

  console.log('✅ Onboarding Test 8+9 Passed!');
}

// ---------------------------------------------------------------------------
// 10. Volunteer cannot create/manage events or other staff
// ---------------------------------------------------------------------------
async function testVolunteerCannotManage() {
  console.log('\nRunning Onboarding Test 10: volunteer cannot create or manage events/staff...');
  const ctx = freshDb();
  const dept = await buildHierarchy(ctx);
  const ev = seedEvent(ctx, 'ev-2', dept);

  // Fully onboarded volunteer (so we test role limits, not the password gate).
  await seedActiveUser(ctx, {
    id: 'vol',
    email: 'volunteer@dsmnru.test',
    role: 'volunteer',
    password: 'VolSecret123'
  });
  assign(ctx, ev, 'vol', 'volunteer');
  ctx.d1.db
    .prepare('INSERT INTO volunteer_event_permissions (event_id, user_id, permission) VALUES (?, ?, ?)')
    .run(ev, 'vol', 'SCAN_ATTENDANCE');

  const vol = await loginAs(ctx, 'volunteer@dsmnru.test', 'VolSecret123');
  if (vol.status !== 200) throw new Error('Volunteer login should succeed');

  const forbidden = [
    { method: 'POST', path: '/api/v1/events', body: { name: 'X' } },
    { method: 'PUT', path: `/api/v1/events/${ev}`, body: { name: 'Y' } },
    { method: 'PUT', path: `/api/v1/events/${ev}/status`, body: { status: 'PUBLISHED' } },
    { method: 'POST', path: '/api/v1/staff/volunteers', body: { email: 'x@y.z', full_name: 'X', event_id: ev } },
    { method: 'POST', path: '/api/v1/staff/coordinators', body: { email: 'x@y.z', full_name: 'X' } },
    { method: 'POST', path: '/api/v1/staff/department-heads', body: { email: 'x@y.z', full_name: 'X', department_id: dept } },
    { method: 'GET', path: `/api/v1/registrations/events/${ev}/registrations` },
    { method: 'POST', path: `/api/v1/certificates/events/${ev}/issue`, body: {} },
    { method: 'POST', path: '/api/v1/departments', body: { name: 'D', code: 'D' } }
  ];

  for (const f of forbidden) {
    const res = await call(ctx, f.path, { method: f.method, cookie: vol.cookie!, body: f.body });
    if (res.status !== 403) {
      throw new Error(`Volunteer must be denied ${f.method} ${f.path} (got ${res.status})`);
    }
  }

  // The volunteer's own scanner capability still works.
  const scan = await call(ctx, `/api/v1/operations/events/${ev}/dashboard`, { cookie: vol.cookie! });
  if (scan.status === 403) {
    throw new Error('Volunteer should retain their assigned operational access');
  }

  console.log('✅ Onboarding Test 10 Passed!');
}

// ---------------------------------------------------------------------------
// Hierarchy guarantees
// ---------------------------------------------------------------------------
async function testHierarchyPreserved() {
  console.log('\nRunning Onboarding Test 11: hierarchy + no public signup + no new Super Admin...');
  const ctx = freshDb();
  const dept = await buildHierarchy(ctx);

  // No public signup.
  const signup = await call(ctx, '/api/v1/auth/register', {
    method: 'POST',
    body: { email: 'x@y.z', password: 'whatever123', full_name: 'X' }
  });
  if (signup.status !== 403 || signup.body?.error?.code !== 'SIGNUP_DISABLED') {
    throw new Error('Public signup must stay disabled');
  }

  // Department Head cannot create another Department Head.
  const dh = await loginAs(ctx, 'dh@dsmnru.test', 'HeadSecret123');
  const dhCreatesDh = await call(ctx, '/api/v1/staff/department-heads', {
    method: 'POST',
    cookie: dh.cookie!,
    body: { email: 'nope@dsmnru.test', full_name: 'Nope', department_id: dept }
  });
  if (dhCreatesDh.status !== 403) throw new Error('Only Super Admin may create Department Heads');

  // Coordinator cannot create a Coordinator.
  const coord = await loginAs(ctx, 'coord@dsmnru.test', 'CoordSecret123');
  const coordCreatesCoord = await call(ctx, '/api/v1/staff/coordinators', {
    method: 'POST',
    cookie: coord.cookie!,
    body: { email: 'nope2@dsmnru.test', full_name: 'Nope' }
  });
  if (coordCreatesCoord.status !== 403) throw new Error('Only Department Head may create Coordinators');

  // Department Head CAN create a Coordinator.
  const ok = await call(ctx, '/api/v1/staff/coordinators', {
    method: 'POST',
    cookie: dh.cookie!,
    body: { email: 'coord2@dsmnru.test', full_name: 'Coord Two' }
  });
  if (ok.status !== 200) throw new Error(`Department Head must be able to create Coordinators: ${JSON.stringify(ok.body)}`);

  // No API creates a Super Admin.
  const admins = ctx.d1.db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'super_admin'").get() as any;
  if (admins.c !== 1) throw new Error(`Super Admin count must stay 1, got ${admins.c}`);

  console.log('✅ Onboarding Test 11 Passed!');
}

// ---------------------------------------------------------------------------
// Security: rate limiting + no plaintext storage
// ---------------------------------------------------------------------------
async function testSecurityControls() {
  console.log('\nRunning Onboarding Test 12: rate limiting and no plaintext passwords...');
  const ctx = freshDb();
  await buildHierarchy(ctx);

  // change-password requires an authenticated session.
  const anon = await call(ctx, '/api/v1/auth/change-password', {
    method: 'POST',
    body: { current_password: 'a', new_password: 'BrandNewPass123' }
  });
  if (anon.status !== 401) throw new Error('change-password must require authentication');

  // Login is rate limited (limits.auth = 20 per window).
  let sawRateLimit = false;
  for (let i = 0; i < 30; i++) {
    const r = await loginAs(ctx, 'dh@dsmnru.test', 'wrong-password');
    if (r.status === 429) {
      sawRateLimit = true;
      break;
    }
  }
  if (!sawRateLimit) throw new Error('Login endpoint must be rate limited');

  // No plaintext password anywhere in the users table.
  const rows = ctx.d1.db.prepare('SELECT email, password_hash FROM users').all() as any[];
  for (const r of rows) {
    if (!String(r.password_hash).startsWith('pbkdf2_sha256$')) {
      throw new Error(`User ${r.email} is not stored as a PBKDF2 hash`);
    }
  }
  console.log('✅ Onboarding Test 12 Passed!');
}

export async function runOnboardingTests() {
  await testNewUserFlags();
  await testFirstLoginGated();
  await testPasswordChangeLifecycle();
  await testExistingUsersUnaffected();
  await testCoordinatorCreatesVolunteer();
  await testVolunteerCannotManage();
  await testHierarchyPreserved();
  await testSecurityControls();
}
