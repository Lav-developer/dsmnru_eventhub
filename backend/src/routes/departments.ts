import { Hono } from 'hono';
import { requireAuth } from '../utils/auth';
import { AppError } from '../utils/errors';
import { logAudit } from '../utils/audit';
import { HonoTypes } from '../types';

const departments = new Hono<HonoTypes>();

// GET / - Publicly accessible list
departments.get('/', async (c) => {
  const db = c.env.DB;
  const list = await db.prepare('SELECT id, name, code, description, created_at FROM departments ORDER BY name ASC').all<any>();
  return c.json({
    success: true,
    data: list.results || []
  });
});

// POST / - Super Admin only
departments.post('/', requireAuth(['super_admin']), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  if (!user) {
    throw new AppError('Unauthorized', 'UNAUTHORIZED', 401);
  }
  const body = await c.req.json().catch(() => ({}));
  const { name, code, description } = body;

  if (!name || !code) {
    throw new AppError('Missing name or code', 'VALIDATION_ERROR', 400);
  }

  const existing = await db.prepare('SELECT id FROM departments WHERE name = ? OR code = ?').bind(name, code.toUpperCase()).first();
  if (existing) {
    throw new AppError('Department name or code already exists', 'CONFLICT', 409);
  }

  const id = crypto.randomUUID();
  await db
    .prepare('INSERT INTO departments (id, name, code, description) VALUES (?, ?, ?, ?)')
    .bind(id, name, code.toUpperCase(), description || null)
    .run();

  await logAudit(
    db,
    user.id,
    user.email,
    'CREATE_DEPARTMENT',
    'department',
    id,
    { name, code: code.toUpperCase() },
    c.req.header('CF-Connecting-IP')
  );

  return c.json({
    success: true,
    data: { id, name, code: code.toUpperCase(), description }
  });
});

// PUT /:id - Super Admin only
departments.put('/:id', requireAuth(['super_admin']), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  if (!user) {
    throw new AppError('Unauthorized', 'UNAUTHORIZED', 401);
  }
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const { name, code, description } = body;

  if (!name || !code) {
    throw new AppError('Missing name or code', 'VALIDATION_ERROR', 400);
  }

  const dept = await db.prepare('SELECT id FROM departments WHERE id = ?').bind(id).first();
  if (!dept) {
    throw new AppError('Department not found', 'NOT_FOUND', 404);
  }

  const conflict = await db
    .prepare('SELECT id FROM departments WHERE (name = ? OR code = ?) AND id != ?')
    .bind(name, code.toUpperCase(), id)
    .first();
  if (conflict) {
    throw new AppError('Another department with this name or code already exists', 'CONFLICT', 409);
  }

  await db
    .prepare('UPDATE departments SET name = ?, code = ?, description = ? WHERE id = ?')
    .bind(name, code.toUpperCase(), description || null, id)
    .run();

  await logAudit(
    db,
    user.id,
    user.email,
    'UPDATE_DEPARTMENT',
    'department',
    id,
    { name, code: code.toUpperCase() },
    c.req.header('CF-Connecting-IP')
  );

  return c.json({
    success: true,
    data: { id, name, code: code.toUpperCase(), description }
  });
});

// DELETE /:id - Super Admin only
departments.delete('/:id', requireAuth(['super_admin']), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  if (!user) {
    throw new AppError('Unauthorized', 'UNAUTHORIZED', 401);
  }
  const id = c.req.param('id');

  const dept = await db.prepare('SELECT id, name FROM departments WHERE id = ?').bind(id).first<any>();
  if (!dept) {
    throw new AppError('Department not found', 'NOT_FOUND', 404);
  }

  await db.prepare("UPDATE departments SET status = 'inactive' WHERE id = ?").bind(id).run();

  await logAudit(
    db,
    user.id,
    user.email,
    'DELETE_DEPARTMENT',
    'department',
    id,
    { name: dept.name },
    c.req.header('CF-Connecting-IP')
  );

  return c.json({
    success: true,
    data: { message: 'Department deleted successfully' }
  });
});

export default departments;
