import { Context, Next } from 'hono';
import { AppError } from './errors';
import { User, UserRole, HonoTypes } from '../types';

/** Columns that exist only after the later migrations have been applied. */
const OPTIONAL_USER_FLAGS = ['password_set', 'force_password_change'] as const;

const BASE_USER_COLUMNS =
  'id, email, full_name, role, status, phone, created_at, updated_at';

function isMissingColumnError(err: unknown, column: string): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /no such column/i.test(message) && message.includes(column);
}

/**
 * Load a user, tolerating a database that has not yet applied the migrations
 * adding password_set / force_password_change.
 *
 * Security note: a flag that cannot be read falls back to 0 (false), i.e. the
 * *permissive* value. That is deliberate and safe — both flags only ever add
 * restrictions (they gate a forced password change). Defaulting them to 1 on a
 * lagging database would lock every user out of the product instead. Any error
 * that is NOT a missing optional column is re-thrown and becomes a 500.
 */
async function selectUserTolerantOfMissingFlags(
  db: D1Database,
  userId: string
): Promise<any> {
  const available = [...OPTIONAL_USER_FLAGS];

  // Retry at most once per optional flag, dropping whichever one D1 rejects.
  for (let attempt = 0; attempt <= OPTIONAL_USER_FLAGS.length; attempt++) {
    const columns = [BASE_USER_COLUMNS, ...available].join(', ');
    try {
      return await db
        .prepare(`SELECT ${columns} FROM users WHERE id = ?`)
        .bind(userId)
        .first<any>();
    } catch (err) {
      const missing = available.find((flag) => isMissingColumnError(err, flag));
      if (!missing) throw err;

      console.error(
        `[Schema] users.${missing} is missing — treating it as 0 and continuing. ` +
          'Run `npm run db:migrate` to apply the outstanding migrations.'
      );
      available.splice(available.indexOf(missing), 1);
    }
  }

  return await db
    .prepare(`SELECT ${BASE_USER_COLUMNS} FROM users WHERE id = ?`)
    .bind(userId)
    .first<any>();
}

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

    // Fetch user.
    //
    // password_set and force_password_change are additive columns introduced by
    // later migrations. If a database is running behind its migrations, asking
    // for them raises "no such column" and would otherwise turn EVERY
    // authenticated request — including unrelated GETs such as /events — into a
    // 500. Authentication itself does not depend on those flags, so a missing
    // one degrades to its default instead of taking the request down.
    const user = await selectUserTolerantOfMissingFlags(db, session.user_id);

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
    // A failure here is an infrastructure fault (schema drift, unavailable D1),
    // never a statement about who the caller is. Silently continuing as
    // anonymous would be worse than failing: an authenticated coordinator would
    // be quietly downgraded and shown the public event list, which looks
    // exactly like "my events disappeared". Surface it as a 500 carrying the
    // request id instead, and let the caller retry.
    const requestId = c.get('requestId');
    console.error(`Auth middleware error (requestId=${requestId}):`, err);
    throw new AppError(
      'Could not verify your session. Please try again.',
      'AUTH_UNAVAILABLE',
      500
    );
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
