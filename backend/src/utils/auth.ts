import { Context, Next } from 'hono';
import { AppError } from './errors';
import { User, UserRole, HonoTypes } from '../types';

export async function authenticate(c: Context<HonoTypes>, next: Next) {
  const db = c.env.DB;
  
  // Enforce secure cookie-only sessions authentication
  let token = '';
  const cookieHeader = c.req.header('Cookie') || '';
  const cookies = Object.fromEntries(
    cookieHeader.split(';').map((cookie) => {
      const parts = cookie.split('=');
      return [parts[0].trim(), parts.slice(1).join('=').trim()];
    })
  );
  
  if (cookies['session_token']) {
    token = cookies['session_token'];
  }

  if (!token) {
    c.set('user', null);
    c.set('session', null);
    return await next();
  }

  try {
    // Look up session
    const session = await db
      .prepare(
        'SELECT id, user_id, token, expires_at, created_at FROM sessions WHERE token = ?'
      )
      .bind(token)
      .first<any>();

    if (!session) {
      c.set('user', null);
      c.set('session', null);
      return await next();
    }

    // Check expiration
    const expiry = new Date(session.expires_at).getTime();
    if (expiry < Date.now()) {
      // Clean up expired session
      await db.prepare('DELETE FROM sessions WHERE id = ?').bind(session.id).run();
      c.set('user', null);
      c.set('session', null);
      return await next();
    }

    // Fetch user
    const user = await db
      .prepare(
        'SELECT id, email, full_name, role, status, phone, created_at, updated_at, password_set, force_password_change FROM users WHERE id = ?'
      )
      .bind(session.user_id)
      .first<any>();

    if (!user || user.status !== 'active') {
      if (user && user.status === 'suspended') {
        await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id).run();
      }
      c.set('user', null);
      c.set('session', null);
      return await next();
    }

    // Attach to context
    const typedUser: User = {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role as UserRole,
      status: user.status as any,
      phone: user.phone || undefined,
      created_at: user.created_at,
      updated_at: user.updated_at,
      password_set: Number(user.password_set) === 1,
      force_password_change: Number(user.force_password_change) === 1
    };

    c.set('user', typedUser);
    c.set('session', session);
  } catch (err) {
    console.error('Auth middleware error:', err);
    c.set('user', null);
    c.set('session', null);
  }

  await next();
}

/**
 * Blocks a first-login session (provisioned email-as-password still active)
 * from reaching any normal authenticated route.
 *
 * This is enforced here, in the shared middleware, rather than per-route, so a
 * forced password change cannot be bypassed by calling an API directly. The
 * only endpoints that may be reached while gated are the ones explicitly
 * exempted in requireAuth (the change-password flow itself, /auth/me and
 * /auth/logout).
 */
export function assertPasswordChangeNotRequired(user: User) {
  if (user.force_password_change) {
    throw new AppError(
      'You must change your password before continuing.',
      'PASSWORD_CHANGE_REQUIRED',
      403
    );
  }
}

export function requireAuth(allowedRoles?: UserRole[], options?: { allowPasswordChangePending?: boolean }) {
  return async (c: Context<HonoTypes>, next: Next) => {
    const user = c.get('user');
    if (!user) {
      throw new AppError('Unauthorized: Authentication required', 'UNAUTHORIZED', 401);
    }

    // Server-side forced-password-change gate. Never trust frontend flags.
    if (!options?.allowPasswordChangePending) {
      assertPasswordChangeNotRequired(user);
    }

    if (allowedRoles && !allowedRoles.includes(user.role)) {
      throw new AppError(
        'Forbidden: You do not have permission to access this resource',
        'FORBIDDEN',
        403
      );
    }

    await next();
  };
}
