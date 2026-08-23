import { generateOpaqueToken, hashPassword, sha256Hex } from './crypto';

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

export async function placeholderPasswordHash(): Promise<string> {
  return hashPassword(generateOpaqueToken(24));
}

export async function invalidateSessions(db: D1Database, userId: string) {
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
}
