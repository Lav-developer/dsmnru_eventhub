import { Hono } from 'hono';
import { requireAuth } from '../utils/auth';
import { AppError } from '../utils/errors';
import { logAudit } from '../utils/audit';
import { HonoTypes, User, VolunteerPermission } from '../types';
import { generateUUID } from '../utils/crypto';
import { createSetupToken, invalidateSessions, placeholderPasswordHash } from '../utils/provision';
import {
  authorizeEventAction,
  getUserDepartmentId,
  requireRoles,
  requireUserDepartment
} from '../utils/authorize';

const staff = new Hono<HonoTypes>();

staff.use('*', requireAuth(['super_admin', 'department_head', 'coordinator']));

async function createProvisionedUser(
  db: D1Database,
  opts: { email: string; full_name: string; phone?: string; role: string; status?: string }
) {
  const email = opts.email.toLowerCase();
  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) {
    throw new AppError('A user with this email already exists', 'EMAIL_EXISTS', 409);
  }
  const userId = generateUUID();
  const passwordHash = await placeholderPasswordHash();
  await db
    .prepare(
      `INSERT INTO users (id, email, password_hash, full_name, phone, role, status, password_set)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
    )
    .bind(userId, email, passwordHash, opts.full_name, opts.phone || null, opts.role, opts.status || 'invited')
    .run();
  const setupToken = await createSetupToken(db, userId);
  return { userId, setupToken };
}

// Super Admin creates Department Head
staff.post('/department-heads', async (c) => {
  const db = c.env.DB;
  const actor = c.get('user') as User;
  requireRoles(actor, ['super_admin']);
  const body = await c.req.json().catch(() => ({}));
  const { email, full_name, phone, department_id } = body;
  if (!email || !full_name || !department_id) {
    throw new AppError('Missing email, full_name, or department_id', 'VALIDATION_ERROR', 400);
  }
  const dept = await db.prepare('SELECT id FROM departments WHERE id = ?').bind(department_id).first();
  if (!dept) throw new AppError('Department not found', 'NOT_FOUND', 404);

  const { userId, setupToken } = await createProvisionedUser(db, {
    email,
    full_name,
    phone,
    role: 'department_head',
    status: 'invited'
  });
  await db
    .prepare('INSERT INTO department_members (department_id, user_id) VALUES (?, ?)')
    .bind(department_id, userId)
    .run();

  await logAudit(db, actor.id, actor.email, 'CREATE_DEPARTMENT_HEAD', 'user', userId, { department_id }, c.req.header('CF-Connecting-IP'));

  return c.json({
    success: true,
    data: {
      id: userId,
      email: email.toLowerCase(),
      role: 'department_head',
      status: 'invited',
      setup_token: setupToken
    }
  });
});

// Department Head creates Coordinator in their department
staff.post('/coordinators', async (c) => {
  const db = c.env.DB;
  const actor = c.get('user') as User;
  requireRoles(actor, ['super_admin', 'department_head']);
  const body = await c.req.json().catch(() => ({}));
  const { email, full_name, phone } = body;
  if (!email || !full_name) {
    throw new AppError('Missing email or full_name', 'VALIDATION_ERROR', 400);
  }

  let departmentId: string;
  if (actor.role === 'department_head') {
    departmentId = await requireUserDepartment(db, actor.id);
  } else {
    if (!body.department_id) throw new AppError('Missing department_id', 'VALIDATION_ERROR', 400);
    departmentId = body.department_id;
  }

  const { userId, setupToken } = await createProvisionedUser(db, {
    email,
    full_name,
    phone,
    role: 'coordinator',
    status: 'invited'
  });
  await db
    .prepare('INSERT INTO department_members (department_id, user_id) VALUES (?, ?)')
    .bind(departmentId, userId)
    .run();

  await logAudit(db, actor.id, actor.email, 'CREATE_COORDINATOR', 'user', userId, { departmentId }, c.req.header('CF-Connecting-IP'));

  return c.json({
    success: true,
    data: { id: userId, email: email.toLowerCase(), role: 'coordinator', status: 'invited', setup_token: setupToken }
  });
});

// Coordinator creates volunteer for an assigned event
staff.post('/volunteers', async (c) => {
  const db = c.env.DB;
  const actor = c.get('user') as User;
  requireRoles(actor, ['super_admin', 'department_head', 'coordinator']);
  const body = await c.req.json().catch(() => ({}));
  const { email, full_name, phone, event_id, permissions } = body;
  if (!email || !full_name || !event_id) {
    throw new AppError('Missing email, full_name, or event_id', 'VALIDATION_ERROR', 400);
  }

  await authorizeEventAction(db, actor, event_id, 'manage_volunteers');

  let userId: string;
  let setupToken: string | undefined;
  const existing = await db
    .prepare('SELECT id, role FROM users WHERE email = ?')
    .bind(email.toLowerCase())
    .first<{ id: string; role: string }>();

  if (existing) {
    if (existing.role !== 'volunteer') {
      throw new AppError('This email belongs to a non-volunteer account', 'CONFLICT', 409);
    }
    userId = existing.id;
  } else {
    const created = await createProvisionedUser(db, {
      email,
      full_name,
      phone,
      role: 'volunteer',
      status: 'invited'
    });
    userId = created.userId;
    setupToken = created.setupToken;
  }

  await db
    .prepare("INSERT OR IGNORE INTO event_members (event_id, user_id, role) VALUES (?, ?, 'volunteer')")
    .bind(event_id, userId)
    .run();

  const perms: VolunteerPermission[] = Array.isArray(permissions) ? permissions : ['SCAN_ATTENDANCE'];
  const allowed: VolunteerPermission[] = ['SCAN_ATTENDANCE', 'SCAN_RESOURCE'];
  for (const p of perms) {
    if (!allowed.includes(p)) continue;
    await db
      .prepare('INSERT OR IGNORE INTO volunteer_event_permissions (event_id, user_id, permission) VALUES (?, ?, ?)')
      .bind(event_id, userId, p)
      .run();
  }

  await logAudit(db, actor.id, actor.email, 'CREATE_VOLUNTEER', 'user', userId, { event_id, permissions: perms }, c.req.header('CF-Connecting-IP'));

  return c.json({
    success: true,
    data: { id: userId, email: email.toLowerCase(), role: 'volunteer', status: setupToken ? 'invited' : 'active', setup_token: setupToken }
  });
});

staff.get('/coordinators', async (c) => {
  const db = c.env.DB;
  const actor = c.get('user') as User;
  requireRoles(actor, ['super_admin', 'department_head']);
  let query = `SELECT u.id, u.email, u.full_name, u.role, u.status, u.phone, dm.department_id
               FROM users u JOIN department_members dm ON dm.user_id = u.id
               WHERE u.role = 'coordinator'`;
  const params: string[] = [];
  if (actor.role === 'department_head') {
    const dept = await requireUserDepartment(db, actor.id);
    query += ' AND dm.department_id = ?';
    params.push(dept);
  }
  const list = await db.prepare(query).bind(...params).all<any>();
  return c.json({ success: true, data: list.results || [] });
});

staff.get('/volunteers', async (c) => {
  const db = c.env.DB;
  const actor = c.get('user') as User;
  const eventId = c.req.query('event_id');
  if (!eventId) throw new AppError('event_id is required', 'VALIDATION_ERROR', 400);
  await authorizeEventAction(db, actor, eventId, 'manage_volunteers');
  const list = await db
    .prepare(
      `SELECT u.id, u.email, u.full_name, u.status, u.phone
       FROM users u
       JOIN event_members em ON em.user_id = u.id
       WHERE em.event_id = ? AND em.role = 'volunteer'`
    )
    .bind(eventId)
    .all<any>();
  return c.json({ success: true, data: list.results || [] });
});

staff.put('/users/:id/status', async (c) => {
  const db = c.env.DB;
  const actor = c.get('user') as User;
  const targetId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const { status } = body;
  if (!['active', 'suspended', 'invited'].includes(status)) {
    throw new AppError('Invalid status', 'VALIDATION_ERROR', 400);
  }
  if (targetId === actor.id) {
    throw new AppError('You cannot change your own status', 'FORBIDDEN', 403);
  }
  const target = await db.prepare('SELECT id, role FROM users WHERE id = ?').bind(targetId).first<any>();
  if (!target) throw new AppError('User not found', 'NOT_FOUND', 404);

  if (actor.role === 'department_head') {
    if (target.role !== 'coordinator') {
      throw new AppError('Department Heads can only manage coordinators', 'FORBIDDEN', 403);
    }
    const actorDept = await requireUserDepartment(db, actor.id);
    const targetDept = await getUserDepartmentId(db, targetId);
    if (actorDept !== targetDept) {
      throw new AppError('Forbidden: coordinator is not in your department', 'FORBIDDEN', 403);
    }
  } else if (actor.role !== 'super_admin') {
    throw new AppError('Forbidden', 'FORBIDDEN', 403);
  }

  await db.prepare("UPDATE users SET status = ?, updated_at = datetime('now') WHERE id = ?").bind(status, targetId).run();
  if (status === 'suspended') {
    await invalidateSessions(db, targetId);
  }
  return c.json({ success: true, data: { message: `Status updated to ${status}` } });
});

export default staff;
