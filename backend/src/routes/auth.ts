import { Hono } from 'hono';
import { AppError } from '../utils/errors';
import { hashPassword, verifyPassword, generateUUID, generateOpaqueToken } from '../utils/crypto';
import { logAudit } from '../utils/audit';
import { rateLimit, limits } from '../utils/rateLimit';
import { HonoTypes } from '../types';
import { getUserDepartmentId } from '../utils/authorize';
import { consumeSetupToken } from '../utils/provision';

const auth = new Hono<HonoTypes>();

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function assertPasswordPolicy(password: string) {
  if (!password || password.length < 8) {
    throw new AppError('Password must be at least 8 characters long', 'VALIDATION_ERROR', 400);
  }
  if (password.length > 100) {
    throw new AppError('Password is too long (maximum 100 characters)', 'VALIDATION_ERROR', 400);
  }
}

// POST /register — bootstrap first Super Admin only. Never trusts client role.
auth.post('/register', rateLimit('auth', limits.auth), async (c) => {
  const db = c.env.DB;
  const body = await c.req.json().catch(() => ({}));
  const { email, full_name, password, phone } = body;

  if (!email || !full_name || !password) {
    throw new AppError('Missing required fields: email, full_name, password', 'VALIDATION_ERROR', 400);
  }

  assertPasswordPolicy(password);

  if (!emailRegex.test(email)) {
    throw new AppError('Invalid email format', 'VALIDATION_ERROR', 400);
  }

  const totalUsersResult = await db.prepare('SELECT COUNT(*) as count FROM users').first<{ count: number }>();
  const isFirstUser = !totalUsersResult || totalUsersResult.count === 0;

  if (!isFirstUser) {
    throw new AppError(
      'Public staff signup is disabled. Accounts are provisioned by Super Admin, Department Head, or Coordinator.',
      'SIGNUP_DISABLED',
      403
    );
  }

  const existingUser = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email.toLowerCase()).first();
  if (existingUser) {
    throw new AppError('A user with this email already exists', 'EMAIL_EXISTS', 409);
  }

  const userId = generateUUID();
  const hashedPassword = await hashPassword(password);

  await db
    .prepare(
      `INSERT INTO users (id, email, password_hash, full_name, phone, role, status, password_set)
       VALUES (?, ?, ?, ?, ?, 'super_admin', 'active', 1)`
    )
    .bind(userId, email.toLowerCase(), hashedPassword, full_name, phone || null)
    .run();

  await logAudit(
    db,
    userId,
    email.toLowerCase(),
    'BOOTSTRAP_SUPER_ADMIN',
    'user',
    userId,
    { role: 'super_admin' },
    c.req.header('CF-Connecting-IP')
  );

  return c.json({
    success: true,
    data: {
      userId,
      email: email.toLowerCase(),
      full_name,
      role: 'super_admin',
      status: 'active'
    }
  });
});

auth.post('/setup-password', rateLimit('auth', limits.auth), async (c) => {
  const db = c.env.DB;
  const body = await c.req.json().catch(() => ({}));
  const { token, password } = body;
  if (!token || !password) {
    throw new AppError('Missing token or password', 'VALIDATION_ERROR', 400);
  }
  assertPasswordPolicy(password);

  const hashedPassword = await hashPassword(password);
  await consumeSetupToken(db, token, hashedPassword);

  return c.json({ success: true, data: { message: 'Password set. You can now log in.' } });
});

auth.post('/login', rateLimit('auth', limits.auth), async (c) => {
  const db = c.env.DB;
  const body = await c.req.json().catch(() => ({}));
  const { email, password } = body;

  if (!email || !password) {
    throw new AppError('Missing email or password', 'VALIDATION_ERROR', 400);
  }
  if (password.length > 100) {
    throw new AppError('Password is too long', 'VALIDATION_ERROR', 400);
  }

  const user = await db
    .prepare('SELECT id, email, password_hash, full_name, role, status FROM users WHERE email = ?')
    .bind(email.toLowerCase())
    .first<any>();

  if (!user) {
    throw new AppError('Invalid email or password', 'INVALID_CREDENTIALS', 401);
  }

  if (user.status === 'suspended') {
    throw new AppError('Your account has been suspended. Please contact an administrator.', 'ACCOUNT_SUSPENDED', 403);
  }

  if (user.status === 'invited' || user.status === 'pending') {
    throw new AppError('Complete account setup using your invite link before logging in.', 'ACCOUNT_SETUP_REQUIRED', 403);
  }

  const isValid = await verifyPassword(password, user.password_hash);
  if (!isValid) {
    throw new AppError('Invalid email or password', 'INVALID_CREDENTIALS', 401);
  }

  const sessionId = generateUUID();
  const sessionToken = generateOpaqueToken(32);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  await db
    .prepare(`INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)`)
    .bind(sessionId, user.id, sessionToken, expiresAt)
    .run();

  const isProd = c.env.ENV === 'production';
  let cookieStr = `session_token=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`;
  if (isProd) {
    cookieStr += '; Secure';
  }
  c.header('Set-Cookie', cookieStr);

  await logAudit(db, user.id, user.email, 'LOGIN', 'user', user.id, { role: user.role }, c.req.header('CF-Connecting-IP'));

  const department_id = await getUserDepartmentId(db, user.id);

  return c.json({
    success: true,
    data: {
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        status: user.status,
        department_id
      }
    }
  });
});

auth.post('/logout', async (c) => {
  const db = c.env.DB;
  const session = c.get('session');
  const user = c.get('user');

  if (session) {
    await db.prepare('DELETE FROM sessions WHERE id = ?').bind(session.id).run();
    if (user) {
      await logAudit(db, user.id, user.email, 'LOGOUT', 'user', user.id, {}, c.req.header('CF-Connecting-IP'));
    }
  }

  c.header('Set-Cookie', 'session_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');

  return c.json({
    success: true,
    data: { message: 'Logged out successfully' }
  });
});

auth.get('/me', async (c) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ success: true, data: { user: null } });
  }
  const department_id = await getUserDepartmentId(c.env.DB, user.id);
  return c.json({
    success: true,
    data: { user: { ...user, department_id } }
  });
});

export default auth;
