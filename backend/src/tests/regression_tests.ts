// Regression tests for the reported outage:
//   * "D1_ERROR: no such column: force_password_change"
//   * events vanishing after refresh / logout / login
//   * participant registration QR + confirmation
//   * volunteer creation and scanner-only permissions
//
// Everything here drives the REAL Hono app (real middleware, real routes, real
// PBKDF2, real authorization) against a real SQLite database built from the
// actual migration files — no mocks, no stubs, no hand-written schema.

import {
  Ctx,
  call,
  freshDb,
  seedDepartment,
  seedActiveUser,
  assign
} from './onboarding_tests';

async function login(ctx: Ctx, email: string, password: string) {
  const res = await call(ctx, '/api/v1/auth/login', {
    method: 'POST',
    body: { email, password }
  });
  if (!res.cookie) {
    throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.cookie;
}

/** Creates an event through the real API, as the given user. */
async function createEvent(
  ctx: Ctx,
  cookie: string,
  overrides: Record<string, any> = {}
): Promise<{ status: number; body: any }> {
  const suffix = Math.random().toString(36).slice(2, 8);
  const res = await call(ctx, '/api/v1/events', {
    method: 'POST',
    cookie,
    body: {
      name: `Regression Event ${suffix}`,
      short_name: `RE${suffix}`,
      event_type: 'seminar',
      start_date: '2026-03-01',
      end_date: '2026-03-02',
      start_time: '10:00',
      end_time: '17:00',
      venue: 'Main Auditorium',
      format: 'offline',
      registration_type: 'built_in',
      ...overrides
    }
  });
  return { status: res.status, body: res.body };
}

/**
 * Drives the real lifecycle DRAFT -> PUBLISHED -> REGISTRATION_OPEN.
 * The API deliberately refuses to skip states, so both steps are required.
 */
async function openRegistration(ctx: Ctx, cookie: string, eventId: string) {
  for (const status of ['PUBLISHED', 'REGISTRATION_OPEN']) {
    const res = await call(ctx, `/api/v1/events/${eventId}/status`, {
      method: 'PUT',
      cookie,
      body: { status }
    });
    if (res.status !== 200) {
      throw new Error(
        `Could not move event to ${status}: ${res.status} ${JSON.stringify(res.body)}`
      );
    }
  }
}

async function listEvents(ctx: Ctx, cookie?: string) {
  return call(ctx, '/api/v1/events', cookie ? { cookie } : {});
}

/** Standard fixture: department + super admin + dept head + coordinator. */
async function seedOrg(ctx: Ctx) {
  const dept = seedDepartment(ctx);
  await seedActiveUser(ctx, {
    id: 'sa',
    email: 'sa@dsmnru.test',
    role: 'super_admin',
    password: 'SuperSecret123'
  });
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
// R1. Existing Super Admin can still log in
// ---------------------------------------------------------------------------
async function testExistingSuperAdminLogin() {
  console.log('\nRunning Regression Test 1: existing Super Admin can log in...');
  const ctx = freshDb();
  await seedOrg(ctx);

  const res = await call(ctx, '/api/v1/auth/login', {
    method: 'POST',
    body: { email: 'sa@dsmnru.test', password: 'SuperSecret123' }
  });

  if (res.status !== 200) {
    throw new Error(`Super Admin login returned ${res.status}: ${JSON.stringify(res.body)}`);
  }
  if (!res.cookie) throw new Error('Super Admin login must issue a session cookie');
  if (res.body?.data?.user?.force_password_change) {
    throw new Error('An already-onboarded Super Admin must not be forced to change password');
  }
  console.log('✅ Regression Test 1 Passed!');
}

// ---------------------------------------------------------------------------
// R2. Existing (non-admin) users can still log in and use the API
// ---------------------------------------------------------------------------
async function testExistingUserLogin() {
  console.log('\nRunning Regression Test 2: existing users can log in and call the API...');
  const ctx = freshDb();
  await seedOrg(ctx);

  for (const [email, password] of [
    ['dh@dsmnru.test', 'HeadSecret123'],
    ['coord@dsmnru.test', 'CoordSecret123']
  ]) {
    const cookie = await login(ctx, email, password);
    const me = await call(ctx, '/api/v1/auth/me', { cookie });
    if (me.status !== 200) {
      throw new Error(`/auth/me for ${email} returned ${me.status}`);
    }
    if (me.body?.data?.force_password_change) {
      throw new Error(`${email} must not be gated: password was already set`);
    }
  }
  console.log('✅ Regression Test 2 Passed!');
}

// ---------------------------------------------------------------------------
// R3. First login forces a password change; afterwards the old one dies
// ---------------------------------------------------------------------------
async function testFirstLoginForcedPasswordChange() {
  console.log('\nRunning Regression Test 3: first login forces a password change...');
  const ctx = freshDb();
  const dept = await seedOrg(ctx);
  const dhCookie = await login(ctx, 'dh@dsmnru.test', 'HeadSecret123');

  // Department Head provisions a coordinator: email doubles as the password.
  const created = await call(ctx, '/api/v1/staff/coordinators', {
    method: 'POST',
    cookie: dhCookie,
    body: {
      email: 'newcoord@dsmnru.test',
      full_name: 'New Coordinator',
      department_id: dept
    }
  });
  if (created.status !== 200 && created.status !== 201) {
    throw new Error(`Coordinator provisioning failed: ${created.status} ${JSON.stringify(created.body)}`);
  }

  // First login with email-as-password succeeds but is gated.
  const first = await call(ctx, '/api/v1/auth/login', {
    method: 'POST',
    body: { email: 'newcoord@dsmnru.test', password: 'newcoord@dsmnru.test' }
  });
  if (first.status !== 200 || !first.cookie) {
    throw new Error('First login with the email-as-password must succeed');
  }
  if (!first.body?.data?.user?.force_password_change) {
    throw new Error('First login must report force_password_change');
  }

  // Gated session cannot reach a normal route.
  const blocked = await listEvents(ctx, first.cookie);
  if (blocked.status !== 403 || blocked.body?.error?.code !== 'PASSWORD_CHANGE_REQUIRED') {
    throw new Error(
      `Gated session must be blocked server-side, got ${blocked.status} ${JSON.stringify(blocked.body)}`
    );
  }

  // Change the password.
  const changed = await call(ctx, '/api/v1/auth/change-password', {
    method: 'POST',
    cookie: first.cookie,
    body: {
      current_password: 'newcoord@dsmnru.test',
      new_password: 'BrandNewPass456'
    }
  });
  if (changed.status !== 200) {
    throw new Error(`Password change failed: ${changed.status} ${JSON.stringify(changed.body)}`);
  }

  // The email-as-password must stop working immediately.
  const reuse = await call(ctx, '/api/v1/auth/login', {
    method: 'POST',
    body: { email: 'newcoord@dsmnru.test', password: 'newcoord@dsmnru.test' }
  });
  if (reuse.status === 200) throw new Error('The initial email-as-password must stop working');

  // The new password works and is no longer gated.
  const after = await call(ctx, '/api/v1/auth/login', {
    method: 'POST',
    body: { email: 'newcoord@dsmnru.test', password: 'BrandNewPass456' }
  });
  if (after.status !== 200) throw new Error('New password must work');
  if (after.body?.data?.user?.force_password_change) {
    throw new Error('force_password_change must be cleared after the change');
  }

  const row: any = ctx.d1.db
    .prepare('SELECT password_set, force_password_change FROM users WHERE email = ?')
    .get('newcoord@dsmnru.test');
  if (row.password_set !== 1 || row.force_password_change !== 0) {
    throw new Error(`Expected password_set=1/force_password_change=0, got ${JSON.stringify(row)}`);
  }
  console.log('✅ Regression Test 3 Passed!');
}

// ---------------------------------------------------------------------------
// R4. A created event is actually persisted in the database
// ---------------------------------------------------------------------------
async function testEventCreationPersists() {
  console.log('\nRunning Regression Test 4: created event is persisted with correct ownership...');
  const ctx = freshDb();
  const dept = await seedOrg(ctx);
  const cookie = await login(ctx, 'coord@dsmnru.test', 'CoordSecret123');

  const { status, body } = await createEvent(ctx, cookie);
  if (status !== 200) throw new Error(`Event creation failed: ${status} ${JSON.stringify(body)}`);

  const id = body?.data?.id;
  if (!id) throw new Error('Event creation must return an id');

  // Straight to the database: it must really be there, owned by the right dept.
  const row: any = ctx.d1.db
    .prepare('SELECT id, department_id, status FROM events WHERE id = ?')
    .get(id);
  if (!row) throw new Error('Event was not persisted in D1');
  if (row.department_id !== dept) {
    throw new Error(`Event stored under department ${row.department_id}, expected ${dept}`);
  }

  // The creator is recorded as an event member, so they keep access.
  const member: any = ctx.d1.db
    .prepare('SELECT role FROM event_members WHERE event_id = ? AND user_id = ?')
    .get(id, 'coord');
  if (!member) throw new Error('Creator must be recorded in event_members');

  console.log('✅ Regression Test 4 Passed!');
}

// ---------------------------------------------------------------------------
// R5. The event survives a refresh and a full logout / login cycle
// ---------------------------------------------------------------------------
async function testEventSurvivesRefreshAndRelogin() {
  console.log('\nRunning Regression Test 5: event survives refresh, logout and re-login...');
  const ctx = freshDb();
  await seedOrg(ctx);

  const firstCookie = await login(ctx, 'coord@dsmnru.test', 'CoordSecret123');
  const { body } = await createEvent(ctx, firstCookie);
  const id = body?.data?.id;

  const contains = (res: any) =>
    Array.isArray(res.body?.data?.events) &&
    res.body.data.events.some((e: any) => e.id === id);

  // "Refresh": a brand new request on the same session.
  const refreshed = await listEvents(ctx, firstCookie);
  if (refreshed.status !== 200) {
    throw new Error(`GET /events after creation returned ${refreshed.status}`);
  }
  if (!contains(refreshed)) throw new Error('Event missing from /events right after creation');

  // Logout, then log back in with a completely fresh session.
  await call(ctx, '/api/v1/auth/logout', { method: 'POST', cookie: firstCookie });
  const secondCookie = await login(ctx, 'coord@dsmnru.test', 'CoordSecret123');
  if (secondCookie === firstCookie) throw new Error('Re-login should establish a new session');

  const afterRelogin = await listEvents(ctx, secondCookie);
  if (afterRelogin.status !== 200) {
    throw new Error(`GET /events after re-login returned ${afterRelogin.status}`);
  }
  if (!contains(afterRelogin)) {
    throw new Error('Event disappeared after logout/login — this is the reported regression');
  }
  console.log('✅ Regression Test 5 Passed!');
}

// ---------------------------------------------------------------------------
// R6. Authorized users can retrieve the event
// ---------------------------------------------------------------------------
async function testAuthorizedUsersCanRetrieveEvent() {
  console.log('\nRunning Regression Test 6: authorized roles can retrieve the event...');
  const ctx = freshDb();
  await seedOrg(ctx);

  const coordCookie = await login(ctx, 'coord@dsmnru.test', 'CoordSecret123');
  const { body } = await createEvent(ctx, coordCookie);
  const id = body?.data?.id;

  for (const [label, email, password] of [
    ['coordinator', 'coord@dsmnru.test', 'CoordSecret123'],
    ['department head', 'dh@dsmnru.test', 'HeadSecret123'],
    ['super admin', 'sa@dsmnru.test', 'SuperSecret123']
  ]) {
    const cookie = await login(ctx, email, password);
    const res = await call(ctx, `/api/v1/events/${id}`, { cookie });
    if (res.status !== 200) {
      throw new Error(`${label} could not retrieve their own event: ${res.status}`);
    }

    const list = await listEvents(ctx, cookie);
    if (!list.body?.data?.events?.some((e: any) => e.id === id)) {
      throw new Error(`${label} cannot see the event in GET /events`);
    }
  }
  console.log('✅ Regression Test 6 Passed!');
}

// ---------------------------------------------------------------------------
// R7. Another department cannot reach the event
// ---------------------------------------------------------------------------
async function testCrossDepartmentAccessDenied() {
  console.log('\nRunning Regression Test 7: another department cannot access the event...');
  const ctx = freshDb();
  await seedOrg(ctx);

  const coordCookie = await login(ctx, 'coord@dsmnru.test', 'CoordSecret123');
  const { body } = await createEvent(ctx, coordCookie);
  const id = body?.data?.id;

  // A coordinator in a different department.
  const otherDept = seedDepartment(ctx, 'dept-me', 'Mechanical', 'ME');
  await seedActiveUser(ctx, {
    id: 'coord2',
    email: 'coord2@dsmnru.test',
    role: 'coordinator',
    password: 'OtherSecret123',
    departmentId: otherDept
  });
  const outsider = await login(ctx, 'coord2@dsmnru.test', 'OtherSecret123');

  // The event is a DRAFT owned by another department: it must not be listed…
  const list = await listEvents(ctx, outsider);
  if (list.body?.data?.events?.some((e: any) => e.id === id)) {
    throw new Error('A DRAFT event leaked into another department\'s event list');
  }

  // …and management actions must be refused.
  const update = await call(ctx, `/api/v1/events/${id}`, {
    method: 'PUT',
    cookie: outsider,
    body: { name: 'Hijacked' }
  });
  if (update.status !== 403 && update.status !== 404) {
    throw new Error(`Cross-department update must be denied, got ${update.status}`);
  }

  const stillNamed: any = ctx.d1.db.prepare('SELECT name FROM events WHERE id = ?').get(id);
  if (stillNamed.name === 'Hijacked') throw new Error('Cross-department update actually mutated the event');

  console.log('✅ Regression Test 7 Passed!');
}

// ---------------------------------------------------------------------------
// R8. Participant registration works
// R9. …and mints a server-side QR token
// ---------------------------------------------------------------------------
async function testParticipantRegistrationAndQrToken() {
  console.log('\nRunning Regression Tests 8+9: participant registration mints a secure QR token...');
  const ctx = freshDb();
  await seedOrg(ctx);

  const coordCookie = await login(ctx, 'coord@dsmnru.test', 'CoordSecret123');
  const { body } = await createEvent(ctx, coordCookie);
  const eventId = body?.data?.id;

  await openRegistration(ctx, coordCookie, eventId);

  const reg = await call(ctx, `/api/v1/registrations/events/${eventId}/register`, {
    method: 'POST',
    body: {
      full_name: 'Rahul Sharma',
      email: 'rahul@student.test',
      phone: '9876543210',
      college: 'DSMNRU',
      department: 'Computer Science',
      course: 'MCA',
      year: '2',
      designation: 'Student',
      custom_responses: {}
    }
  });
  if (reg.status !== 200) {
    throw new Error(`Registration failed: ${reg.status} ${JSON.stringify(reg.body)}`);
  }

  const data = reg.body?.data;
  if (!data?.registrationId) throw new Error('Registration must return a registration ID');

  // R9: the QR payload must be the server-generated opaque token for THIS
  // registration — never the participant id, email or any client-supplied value.
  const stored: any = ctx.d1.db
    .prepare('SELECT id, qr_token, email FROM event_registrations WHERE registration_id = ?')
    .get(data.registrationId);
  if (!stored?.qr_token) throw new Error('No qr_token was persisted for the registration');
  if (data.id !== stored.qr_token) {
    throw new Error('The QR payload must be the stored opaque token for that exact registration');
  }
  if (data.id === stored.id) throw new Error('The QR must not expose the internal record id');
  if (String(data.id).length < 32) throw new Error('The QR token is too short to be unguessable');
  if (String(data.id).includes(stored.email)) {
    throw new Error('The QR token must not embed the participant email');
  }

  // The confirmation payload must carry what the success page has to display.
  if (!data.event?.name || !data.event?.venue || !data.event?.start_date) {
    throw new Error('Registration response must include event details for the confirmation page');
  }
  if (data.full_name !== 'Rahul Sharma') {
    throw new Error('Registration response must include the participant name');
  }

  console.log('✅ Regression Tests 8+9 Passed!');
}

// ---------------------------------------------------------------------------
// R10. The QR is retrievable for display on the confirmation page
// R11. …and the same payload backs the download action
// ---------------------------------------------------------------------------
async function testQrRetrievableAndDownloadable() {
  console.log('\nRunning Regression Tests 10+11: QR is shown on confirmation and can be saved...');
  const ctx = freshDb();
  await seedOrg(ctx);

  const coordCookie = await login(ctx, 'coord@dsmnru.test', 'CoordSecret123');
  const { body } = await createEvent(ctx, coordCookie);
  const eventId = body?.data?.id;
  await openRegistration(ctx, coordCookie, eventId);

  const reg = await call(ctx, `/api/v1/registrations/events/${eventId}/register`, {
    method: 'POST',
    body: {
      full_name: 'Anita Verma',
      email: 'anita@student.test',
      phone: '9000000000',
      college: 'DSMNRU',
      department: 'Computer Science',
      course: 'MCA',
      year: '1',
      designation: 'Student',
      custom_responses: {}
    }
  });
  const token = reg.body?.data?.id;
  const registrationId = reg.body?.data?.registrationId;

  // The pass endpoint backs both the emailed link and re-downloading the QR.
  const pass = await call(ctx, `/api/v1/registrations/pass/${token}`);
  if (pass.status !== 200) {
    throw new Error(`Pass retrieval failed: ${pass.status} ${JSON.stringify(pass.body)}`);
  }
  if (pass.body?.data?.id !== token) {
    throw new Error('Pass endpoint must return the same QR payload that was issued');
  }
  if (pass.body?.data?.registrationId !== registrationId) {
    throw new Error('Pass must belong to exactly that registration');
  }
  if (!pass.body?.data?.event?.name) {
    throw new Error('Pass must include event details so it can be rendered and printed');
  }

  // It must not leak extra personal data.
  const serialized = JSON.stringify(pass.body);
  for (const leak of ['9000000000', 'anita@student.test']) {
    if (serialized.includes(leak)) {
      throw new Error(`Pass response leaked sensitive participant data: ${leak}`);
    }
  }

  // An unknown / guessed token must not resolve.
  const bogus = await call(ctx, `/api/v1/registrations/pass/${'0'.repeat(64)}`);
  if (bogus.status !== 404) {
    throw new Error(`An invalid pass token must 404, got ${bogus.status}`);
  }

  console.log('✅ Regression Tests 10+11 Passed!');
}

// ---------------------------------------------------------------------------
// R12. A coordinator can create a volunteer for their own event
// R13. …and that volunteer is scanner-only
// ---------------------------------------------------------------------------
async function testVolunteerCreationAndScannerOnlyPermissions() {
  console.log('\nRunning Regression Tests 12+13: volunteer creation and scanner-only rights...');
  const ctx = freshDb();
  await seedOrg(ctx);

  const coordCookie = await login(ctx, 'coord@dsmnru.test', 'CoordSecret123');
  const { body } = await createEvent(ctx, coordCookie);
  const eventId = body?.data?.id;

  // R12: create the volunteer through the event workflow.
  const created = await call(ctx, '/api/v1/staff/volunteers', {
    method: 'POST',
    cookie: coordCookie,
    body: { email: 'vol@dsmnru.test', full_name: 'Volunteer One', event_id: eventId }
  });
  if (created.status !== 200 && created.status !== 201) {
    throw new Error(`Volunteer creation failed: ${created.status} ${JSON.stringify(created.body)}`);
  }

  const volRow: any = ctx.d1.db
    .prepare('SELECT id, role, password_set, force_password_change FROM users WHERE email = ?')
    .get('vol@dsmnru.test');
  if (!volRow) throw new Error('Volunteer user was not persisted');
  if (volRow.role !== 'volunteer') throw new Error(`Volunteer got role ${volRow.role}`);
  if (volRow.force_password_change !== 1) {
    throw new Error('A provisioned volunteer must be forced to change their password');
  }

  const membership: any = ctx.d1.db
    .prepare('SELECT role FROM event_members WHERE event_id = ? AND user_id = ?')
    .get(eventId, volRow.id);
  if (membership?.role !== 'volunteer') {
    throw new Error('Volunteer must be attached to the event they were created for');
  }

  // Onboard the volunteer so we can exercise their real permissions.
  const firstLogin = await call(ctx, '/api/v1/auth/login', {
    method: 'POST',
    body: { email: 'vol@dsmnru.test', password: 'vol@dsmnru.test' }
  });
  await call(ctx, '/api/v1/auth/change-password', {
    method: 'POST',
    cookie: firstLogin.cookie!,
    body: { current_password: 'vol@dsmnru.test', new_password: 'VolunteerPass789' }
  });
  const volCookie = await login(ctx, 'vol@dsmnru.test', 'VolunteerPass789');

  // R13: scanning is allowed…
  const scan = await call(ctx, `/api/v1/operations/events/${eventId}/scan/attendance`, {
    method: 'POST',
    cookie: volCookie,
    body: { opaque_token: 'not-a-real-token' }
  });
  if (scan.status === 401 || scan.status === 403) {
    throw new Error(`Volunteer must be allowed to reach the attendance scanner, got ${scan.status}`);
  }

  // …but nothing privileged is.
  const forbidden: Array<[string, string, any]> = [
    ['create event', 'POST /api/v1/events', null],
    ['manage volunteers', 'POST /api/v1/staff/volunteers', {
      email: 'vol2@dsmnru.test',
      full_name: 'Volunteer Two',
      event_id: eventId
    }],
    ['edit event', `PUT /api/v1/events/${eventId}`, { name: 'Renamed by volunteer' }],
    ['change event status', `PUT /api/v1/events/${eventId}/status`, { status: 'PUBLISHED' }],
    ['view registrations', `GET /api/v1/registrations/events/${eventId}/registrations`, null]
  ];

  for (const [label, spec, payload] of forbidden) {
    const [method, path] = spec.split(' ');
    const res = await call(ctx, path, {
      method,
      cookie: volCookie,
      ...(payload ? { body: payload } : {})
    });
    if (res.status !== 403) {
      throw new Error(`Volunteer must be refused "${label}" with 403, got ${res.status}`);
    }
  }

  // A volunteer must not be able to create a volunteer either — verify nothing appeared.
  const sneaked = ctx.d1.db.prepare('SELECT id FROM users WHERE email = ?').get('vol2@dsmnru.test');
  if (sneaked) throw new Error('A volunteer managed to provision another user');

  console.log('✅ Regression Tests 12+13 Passed!');
}

// ---------------------------------------------------------------------------
// R14. GET /events must never 500 (the original "events vanished" symptom)
// ---------------------------------------------------------------------------
async function testEventListingNeverErrorsForAnyRole() {
  console.log('\nRunning Regression Test 14: GET /events succeeds for every role...');
  const ctx = freshDb();
  await seedOrg(ctx);

  const coordCookie = await login(ctx, 'coord@dsmnru.test', 'CoordSecret123');
  await createEvent(ctx, coordCookie);

  // Anonymous — this used to 500 because the count query referenced `e.status`
  // while selecting `FROM events` without the alias.
  const anon = await listEvents(ctx);
  if (anon.status !== 200) {
    throw new Error(`Anonymous GET /events returned ${anon.status}: ${JSON.stringify(anon.body)}`);
  }

  for (const [email, password] of [
    ['sa@dsmnru.test', 'SuperSecret123'],
    ['dh@dsmnru.test', 'HeadSecret123'],
    ['coord@dsmnru.test', 'CoordSecret123']
  ]) {
    const cookie = await login(ctx, email, password);
    const res = await listEvents(ctx, cookie);
    if (res.status !== 200) {
      throw new Error(`GET /events as ${email} returned ${res.status}: ${JSON.stringify(res.body)}`);
    }
    // Pagination must be well formed — the frontend unwraps { events, pagination }.
    if (!Array.isArray(res.body?.data?.events)) {
      throw new Error(`GET /events as ${email} did not return an events array`);
    }
    if (typeof res.body?.data?.pagination?.total !== 'number') {
      throw new Error(`GET /events as ${email} returned a broken pagination total`);
    }
  }

  // Filters and search exercise the same shared WHERE clauses.
  const coordCookie2 = await login(ctx, 'coord@dsmnru.test', 'CoordSecret123');
  for (const qs of ['?search=Regression', '?status=DRAFT', '?limit=1&page=1', '?type=seminar']) {
    const res = await call(ctx, `/api/v1/events${qs}`, { cookie: coordCookie2 });
    if (res.status !== 200) {
      throw new Error(`GET /events${qs} returned ${res.status}: ${JSON.stringify(res.body)}`);
    }
  }

  console.log('✅ Regression Test 14 Passed!');
}

// ---------------------------------------------------------------------------
// R15. Auth must not collapse when an optional column is missing
// ---------------------------------------------------------------------------
async function testAuthSurvivesMissingOptionalColumn() {
  console.log('\nRunning Regression Test 15: auth tolerates a lagging schema...');
  const ctx = freshDb();
  await seedOrg(ctx);

  const cookie = await login(ctx, 'coord@dsmnru.test', 'CoordSecret123');
  await createEvent(ctx, cookie);

  // Simulate a database that has not yet applied 0004: drop the column while a
  // valid session is live. Unrelated GETs must keep working rather than 500.
  ctx.d1.db.exec('ALTER TABLE users DROP COLUMN force_password_change');

  const res = await listEvents(ctx, cookie);
  if (res.status === 500) {
    throw new Error('A missing optional column must not turn GET /events into a 500');
  }
  if (res.status !== 200) {
    throw new Error(`GET /events with a lagging schema returned ${res.status}`);
  }

  const me = await call(ctx, '/api/v1/auth/me', { cookie });
  if (me.status !== 200) {
    throw new Error(`/auth/me with a lagging schema returned ${me.status}`);
  }
  console.log('✅ Regression Test 15 Passed!');
}

export async function runRegressionTests() {
  await testExistingSuperAdminLogin();
  await testExistingUserLogin();
  await testFirstLoginForcedPasswordChange();
  await testEventCreationPersists();
  await testEventSurvivesRefreshAndRelogin();
  await testAuthorizedUsersCanRetrieveEvent();
  await testCrossDepartmentAccessDenied();
  await testParticipantRegistrationAndQrToken();
  await testQrRetrievableAndDownloadable();
  await testVolunteerCreationAndScannerOnlyPermissions();
  await testEventListingNeverErrorsForAnyRole();
  await testAuthSurvivesMissingOptionalColumn();
}
