import { generateOpaqueToken, hashPassword, sha256Hex } from './crypto';
import { AppError } from './errors';

export async function createSetupToken(
  db: D1Database,
  userId: string,
  ttlHours = 48
): Promise<string> {
  const raw = generateOpaqueToken(32);
  const tokenHash = await sha256Hex(raw);
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
  await db
    .prepare(
      `INSERT INTO account_setup_tokens (id, user_id, token_hash, expires_at)
       VALUES (?, ?, ?, ?)`
    )
    .bind(crypto.randomUUID(), userId, tokenHash, expiresAt)
    .run();
  return raw;
}

export async function consumeSetupToken(
  db: D1Database,
  token: string,
  newPasswordHash: string
): Promise<string> {
  const tokenHash = await sha256Hex(token);
  const row = await db
    .prepare(`SELECT id, user_id, expires_at, used_at FROM account_setup_tokens WHERE token_hash = ?`)
    .bind(tokenHash)
    .first<{ id: string; user_id: string; expires_at: string; used_at: string | null }>();

  if (!row || row.used_at) {
    throw new AppError('Invalid or already used setup token', 'INVALID_TOKEN', 400);
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw new AppError('Setup token has expired', 'TOKEN_EXPIRED', 400);
  }

  await db
    .prepare(
      `UPDATE users SET password_hash = ?, status = 'active', password_set = 1, force_password_change = 0, updated_at = datetime('now') WHERE id = ?`
    )
    .bind(newPasswordHash, row.user_id)
    .run();
  await db.prepare(`UPDATE account_setup_tokens SET used_at = datetime('now') WHERE id = ?`).bind(row.id).run();
  return row.user_id;
}

export async function placeholderPasswordHash(): Promise<string> {
  return hashPassword(generateOpaqueToken(24));
}

/**
 * Initial password for accounts provisioned by the role hierarchy.
 *
 * The user's own email address is the initial password. Only its PBKDF2 hash is
 * ever stored — the plaintext is never persisted or logged. It is accepted for
 * the first successful login only: that login is gated by
 * force_password_change = 1, and completing the change sets password_set = 1 /
 * force_password_change = 0, which invalidates it immediately.
 */
export async function initialPasswordHashForEmail(email: string): Promise<string> {
  return hashPassword(email.toLowerCase());
}

/**
 * Completes a forced password change for a first-login session.
 *
 * Clears the gate, marks the password as user-chosen, and (by the caller
 * invalidating sessions) makes the initial email-as-password unusable.
 */
export async function completeForcedPasswordChange(
  db: D1Database,
  userId: string,
  newPasswordHash: string
): Promise<void> {
  await db
    .prepare(
      `UPDATE users
         SET password_hash = ?,
             status = 'active',
             password_set = 1,
             force_password_change = 0,
             updated_at = datetime('now')
       WHERE id = ?`
    )
    .bind(newPasswordHash, userId)
    .run();
}

export async function invalidateSessions(db: D1Database, userId: string) {
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
}
