export async function logAudit(
  db: D1Database,
  userId: string | null | undefined,
  userEmail: string | null | undefined,
  action: string,
  targetType: string,
  targetId: string | null | undefined,
  details: Record<string, any>,
  ipAddress?: string | null | undefined
): Promise<void> {
  try {
    const id = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO audit_logs (id, user_id, user_email, action, target_type, target_id, details, ip_address)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        userId || null,
        userEmail || null,
        action,
        targetType,
        targetId || null,
        JSON.stringify(details),
        ipAddress || null
      )
      .run();
  } catch (err) {
    console.error('Audit logging failed:', err);
  }
}
