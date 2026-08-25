import { Hono } from 'hono';
import { AppError } from '../utils/errors';
import { hashPassword, verifyPassword, generateUUID, generateOpaqueToken } from '../utils/crypto';
import { logAudit } from '../utils/audit';
import { rateLimit, limits } from '../utils/rateLimit';
import { HonoTypes } from '../types';
import { getUserDepartmentId } from '../utils/authorize';
import { completeForcedPasswordChange, consumeSetupToken, invalidateSessions } from '../utils/provision';

const auth = new Hono<HonoTypes>();

function assertPasswordPolicy(password: string) {
  if (!password || password.length < 8) {
    throw new AppError('Password must be at least 8 characters long', 'VALIDATION_ERROR', 400);
  }
  if (password.length > 100) {
    throw new AppError('Password is too long (maximum 100 characters)', 'VALIDATION_ERROR', 400);
  }
}

auth.post('/register', rateLimit('auth', limits.auth), async () => {
  throw new AppError('Public signup is disabled. Staff accounts are provisioned by the role hierarchy.', 'SIGNUP_DISABLED', 403);
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
    .prepare(
      'SELECT id, email, password_hash, full_name, role, status, password_set, force_password_change FROM users WHERE email = ?'
    )
    .bind(email.toLowerCase())
    .first<any>();

  if (!user) {
    throw new AppError('Invalid email or password', 'INVALID_CREDENTIALS', 401);
  }

  if (user.status === 'suspended') {
    throw new AppError('Your account has been suspended. Please contact an administrator.', 'ACCOUNT_SUSPENDED', 403);
  }

  if (user.status !== 'active') {
    throw new AppError('This account cannot log in.', 'ACCOUNT_INACTIVE', 403);
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

  const forcePasswordChange = Number(user.force_password_change) === 1;

  await logAudit(
    db,
    user.id,
    user.email,
    'LOGIN',
    'user',
    user.id,
    { role: user.role, force_password_change: forcePasswordChange },
    c.req.header('CF-Connecting-IP')
  );

  const department_id = await getUserDepartmentId(db, user.id);

  return c.json({
    success: true,
    data: {
      // Server-side truth. The client uses this only to route the user to the
      // change-password screen; every API is gated independently server-side.
      force_password_change: forcePasswordChange,
      password_set: Number(user.password_set) === 1,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        status: user.status,
        department_id,
        password_set: Number(user.password_set) === 1,
        force_password_change: forcePasswordChange
      }
    }
  });
});

/**
 * Change password for the currently authenticated session.
 *
 * Used both for the mandatory first-login change (force_password_change = 1)
 * and for ordinary voluntary password changes. Requires the authenticated
 * session, verifies the current password, then rotates the session so the old
 * one — including the initial email-as-password session — is dead.
 */
auth.post('/change-password', rateLimit('auth', limits.auth), async (c) => {
  const db = c.env.DB;
  const actor = c.get('user');
  const session = c.get('session');

  if (!actor) {
    throw new AppError('Unauthorized: Authentication required', 'UNAUTHORIZED', 401);
  }

  const body = await c.req.json().catch(() => ({}));
  const { current_password, new_password } = body;

  if (!current_password || !new_password) {
    throw new AppError('Missing current_password or new_password', 'VALIDATION_ERROR', 400);
  }
  assertPasswordPolicy(new_password);

  const row = await db
    .prepare('SELECT id, email, password_hash FROM users WHERE id = ?')
    .bind(actor.id)
    .first<{ id: string; email: string; password_hash: string }>();
  if (!row) {
    throw new AppError('User not found', 'NOT_FOUND', 404);
  }

  const validCurrent = await verifyPassword(current_password, row.password_hash);
  if (!validCurrent) {
    throw new AppError('Current password is incorrect', 'INVALID_CREDENTIALS', 401);
  }

  // The new password may not be the email-as-password again, otherwise the
  // initial credential would remain valid.
  if (new_password.toLowerCase() === row.email.toLowerCase()) {
    throw new AppError(
      'Your new password cannot be the same as your email address',
      'VALIDATION_ERROR',
      400
    );
  }
  if (new_password === current_password) {
    throw new AppError('Your new password must be different from the current one', 'VALIDATION_ERROR', 400);
  }

  const newHash = await hashPassword(new_password);
  await completeForcedPasswordChange(db, row.id, newHash);

  // Invalidate every existing session (including this first-login one), then
  // issue a fresh authenticated session.
  await invalidateSessions(db, row.id);

  const sessionId = generateUUID();
  const sessionToken = generateOpaqueToken(32);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await db
    .prepare(`INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)`)
    .bind(sessionId, row.id, sessionToken, expiresAt)
    .run();

  const isProd = c.env.ENV === 'production';
  let cookieStr = `session_token=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`;
  if (isProd) {
    cookieStr += '; Secure';
  }
  c.header('Set-Cookie', cookieStr);

  await logAudit(
    db,
    row.id,
    row.email,
    'CHANGE_PASSWORD',
    'user',
    row.id,
    { forced: !!actor.force_password_change, previous_session: session?.id || null },
    c.req.header('CF-Connecting-IP')
  );

  return c.json({
    success: true,
    data: { message: 'Password updated. Your new password is now required to log in.' }
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
    data: {
      force_password_change: !!user.force_password_change,
      password_set: !!user.password_set,
      user: { ...user, department_id }
    }
  });
});

export default auth;
