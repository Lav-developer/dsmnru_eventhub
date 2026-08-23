import { Hono } from 'hono';
import { requireAuth } from '../utils/auth';
import { AppError } from '../utils/errors';
import { logAudit } from '../utils/audit';
import { HonoTypes } from '../types';

const admin = new Hono<HonoTypes>();

// Apply super_admin restriction to all routes in this router
admin.use('*', requireAuth(['super_admin']));

// GET /users
admin.get('/users', async (c) => {
  const db = c.env.DB;
  const page = parseInt(c.req.query('page') || '1', 10);
  const limit = parseInt(c.req.query('limit') || '10', 10);
  const search = c.req.query('search') || '';
  const role = c.req.query('role') || '';
  const status = c.req.query('status') || '';

  const offset = (page - 1) * limit;

  let query = 'SELECT id, email, full_name, role, status, phone, created_at FROM users WHERE 1=1';
  let countQuery = 'SELECT COUNT(*) as count FROM users WHERE 1=1';
  const params: any[] = [];
  const countParams: any[] = [];

  if (search) {
    const searchPattern = `%${search}%`;
    query += ' AND (full_name LIKE ? OR email LIKE ?)';
    countQuery += ' AND (full_name LIKE ? OR email LIKE ?)';
    params.push(searchPattern, searchPattern);
    countParams.push(searchPattern, searchPattern);
  }

  if (role) {
    query += ' AND role = ?';
    countQuery += ' AND role = ?';
    params.push(role);
    countParams.push(role);
  }

  if (status) {
    query += ' AND status = ?';
    countQuery += ' AND status = ?';
    params.push(status);
    countParams.push(status);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const [users, totalResult] = await Promise.all([
    db.prepare(query).bind(...params).all<any>(),
    db.prepare(countQuery).bind(...countParams).first<{ count: number }>()
  ]);

  const total = totalResult ? totalResult.count : 0;

  return c.json({
    success: true,
    data: {
      users: users.results || [],
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    }
  });
});

// PUT /users/:id/status
admin.put('/users/:id/status', async (c) => {
  const db = c.env.DB;
  const targetUserId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const { status } = body;

  const currentUser = c.get('user');
  if (!currentUser) {
    throw new AppError('Unauthorized', 'UNAUTHORIZED', 401);
  }

  if (!status || !['active', 'suspended', 'pending'].includes(status)) {
    throw new AppError('Invalid status specified', 'VALIDATION_ERROR', 400);
  }

  // Prevent self-suspension
  if (targetUserId === currentUser.id) {
    throw new AppError('You cannot change your own status', 'FORBIDDEN', 403);
  }

  const userExists = await db.prepare('SELECT id, email, role FROM users WHERE id = ?').bind(targetUserId).first<any>();
  if (!userExists) {
    throw new AppError('User not found', 'NOT_FOUND', 404);
  }

  await db.prepare('UPDATE users SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').bind(status, targetUserId).run();

  // If suspended, revoke all active sessions
  if (status === 'suspended') {
    await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(targetUserId).run();
  }

  await logAudit(
    db,
    currentUser.id,
    currentUser.email,
    'UPDATE_USER_STATUS',
    'user',
    targetUserId,
    { status, targetUserEmail: userExists.email },
    c.req.header('CF-Connecting-IP')
  );

  return c.json({
    success: true,
    data: { message: `User status updated to ${status} successfully` }
  });
});

// PUT /users/:id/role
admin.put('/users/:id/role', async (c) => {
  const db = c.env.DB;
  const targetUserId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const { role } = body;

  const currentUser = c.get('user');
  if (!currentUser) {
    throw new AppError('Unauthorized', 'UNAUTHORIZED', 401);
  }

  if (!role || !['department_head', 'coordinator', 'volunteer'].includes(role)) {
    throw new AppError('Invalid role specified. Super Admin cannot be assigned through the API.', 'VALIDATION_ERROR', 400);
  }

  if (targetUserId === currentUser.id) {
    throw new AppError('You cannot change your own role', 'FORBIDDEN', 403);
  }

  const userExists = await db.prepare('SELECT id, email FROM users WHERE id = ?').bind(targetUserId).first<any>();
  if (!userExists) {
    throw new AppError('User not found', 'NOT_FOUND', 404);
  }

  await db.prepare('UPDATE users SET role = ?, updated_at = datetime(\'now\') WHERE id = ?').bind(role, targetUserId).run();
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(targetUserId).run();

  await logAudit(
    db,
    currentUser.id,
    currentUser.email,
    'UPDATE_USER_ROLE',
    'user',
    targetUserId,
    { role, targetUserEmail: userExists.email },
    c.req.header('CF-Connecting-IP')
  );

  return c.json({
    success: true,
    data: { message: `User role updated to ${role} successfully` }
  });
});

// GET /health - observability and system health
admin.get('/health', async (c) => {
  const db = c.env.DB;

  // Measure database latency
  const start = Date.now();
  await db.prepare('SELECT 1').first();
  const dbLatencyMs = Date.now() - start;

  // Get recent errors from audit logs or generic summary stats
  const stats = await db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM users) as total_users,
      (SELECT COUNT(*) FROM events) as total_events,
      (SELECT COUNT(*) FROM event_registrations) as total_registrations,
      (SELECT COUNT(*) FROM audit_logs WHERE action = 'ERROR') as error_logs_count
  `).first<any>();

  // Fetch 10 most recent error or audit logs
  const logs = await db.prepare('SELECT id, user_email, action, target_type, details, timestamp FROM audit_logs ORDER BY timestamp DESC LIMIT 20').all<any>();

  return c.json({
    success: true,
    data: {
      status: 'healthy',
      database: {
        status: 'connected',
        latencyMs: dbLatencyMs
      },
      stats: stats || {},
      recentLogs: logs.results || []
    }
  });
});

export default admin;
