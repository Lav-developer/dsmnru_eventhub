import { Hono } from 'hono';
import { AppError } from '../utils/errors';
import { hashPassword, verifyPassword, generateUUID, generateOpaqueToken } from '../utils/crypto';
import { logAudit } from '../utils/audit';
import { rateLimit, limits } from '../utils/rateLimit';
import { HonoTypes } from '../types';

const auth = new Hono<HonoTypes>();

// POST /register
auth.post('/register', rateLimit('auth', limits.auth), async (c) => {
  const db = c.env.DB;
  const body = await c.req.json().catch(() => ({}));
  const { email, full_name, password, phone, role } = body;

  if (!email || !full_name || !password || !role) {
    throw new AppError('Missing required fields: email, full_name, password, role', 'VALIDATION_ERROR', 400);
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new AppError('Invalid email format', 'VALIDATION_ERROR', 400);
  }

  // Validate role
  const allowedRoles = ['department_head', 'coordinator', 'volunteer'];
  if (!allowedRoles.includes(role)) {
    throw new AppError('Invalid role specified', 'VALIDATION_ERROR', 400);
  }

  // Check if email already exists
  const existingUser = await db
    .prepare('SELECT id FROM users WHERE email = ?')
    .bind(email.toLowerCase())
    .first();

  if (existingUser) {
    throw new AppError('A user with this email already exists', 'EMAIL_EXISTS', 409);
  }

  // Check if system is empty to assign first user as Active Super Admin
  const totalUsersResult = await db.prepare('SELECT COUNT(*) as count FROM users').first<{ count: number }>();
  const isFirstUser = !totalUsersResult || totalUsersResult.count === 0;

  const userId = generateUUID();
  const hashedPassword = await hashPassword(password);
  const finalRole = isFirstUser ? 'super_admin' : role;
  const finalStatus = isFirstUser ? 'active' : 'pending';

  await db
    .prepare(
      `INSERT INTO users (id, email, password_hash, full_name, phone, role, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(userId, email.toLowerCase(), hashedPassword, full_name, phone || null, finalRole, finalStatus)
    .run();

  await logAudit(
    db,
    userId,
    email.toLowerCase(),
    'REGISTER',
    'user',
    userId,
    { role: finalRole, status: finalStatus, isFirstUser },
    c.req.header('CF-Connecting-IP')
  );

  return c.json({
    success: true,
    data: {
      userId,
      email: email.toLowerCase(),
      full_name,
      role: finalRole,
      status: finalStatus
    }
  });
});

// POST /login
auth.post('/login', rateLimit('auth', limits.auth), async (c) => {
  const db = c.env.DB;
  const body = await c.req.json().catch(() => ({}));
  const { email, password } = body;

  if (!email || !password) {
    throw new AppError('Missing email or password', 'VALIDATION_ERROR', 400);
  }

  const user = await db
    .prepare('SELECT id, email, password_hash, full_name, role, status FROM users WHERE email = ?')
    .bind(email.toLowerCase())
    .first<any>();

  if (!user) {
    // Audit failed attempt (avoid user enumeration by returning generic error)
    throw new AppError('Invalid email or password', 'INVALID_CREDENTIALS', 401);
  }

  if (user.status === 'suspended') {
    throw new AppError('Your account has been suspended. Please contact an administrator.', 'ACCOUNT_SUSPENDED', 403);
  }

  if (user.status === 'pending') {
    throw new AppError('Your account is pending approval by a Super Admin.', 'ACCOUNT_PENDING', 403);
  }

  // Verify password
  const isValid = await verifyPassword(password, user.password_hash);
  if (!isValid) {
    throw new AppError('Invalid email or password', 'INVALID_CREDENTIALS', 401);
  }

  // Create session
  const sessionId = generateUUID();
  const sessionToken = generateOpaqueToken(32);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

  await db
    .prepare(
      `INSERT INTO sessions (id, user_id, token, expires_at)
       VALUES (?, ?, ?, ?)`
    )
    .bind(sessionId, user.id, sessionToken, expiresAt)
    .run();

  // Set secure cookie
  const isProd = c.env.ENV === 'production';
  let cookieStr = `session_token=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`;
  if (isProd) {
    cookieStr += '; Secure';
  }
  c.header('Set-Cookie', cookieStr);

  await logAudit(
    db,
    user.id,
    user.email,
    'LOGIN',
    'user',
    user.id,
    { role: user.role },
    c.req.header('CF-Connecting-IP')
  );

  return c.json({
    success: true,
    data: {
      token: sessionToken,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        status: user.status
      }
    }
  });
});

// POST /logout
auth.post('/logout', async (c) => {
  const db = c.env.DB;
  const session = c.get('session');
  const user = c.get('user');

  if (session) {
    await db.prepare('DELETE FROM sessions WHERE id = ?').bind(session.id).run();
    if (user) {
      await logAudit(
        db,
        user.id,
        user.email,
        'LOGOUT',
        'user',
        user.id,
        {},
        c.req.header('CF-Connecting-IP')
      );
    }
  }

  // Clear cookie
  c.header('Set-Cookie', 'session_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');

  return c.json({
    success: true,
    data: { message: 'Logged out successfully' }
  });
});

// GET /me
auth.get('/me', async (c) => {
  const user = c.get('user');
  if (!user) {
    return c.json({
      success: true,
      data: { user: null }
    });
  }

  return c.json({
    success: true,
    data: { user }
  });
});

export default auth;
