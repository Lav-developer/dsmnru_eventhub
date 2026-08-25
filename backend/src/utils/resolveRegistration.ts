import { AppError } from './errors';

export interface ResolvedRegistration {
  /** Internal event_registrations.id (UUID) — the FK used by attendance/claims. */
  id: string;
  /** Human-readable code, e.g. DSMNRU-DEMO-6K8KGU. */
  registration_id: string;
  full_name: string;
  email: string;
  college: string;
  /** Which identifier form the scanner presented. Useful for audit trails. */
  matchedBy: 'qr_token' | 'registration_id';
}

/**
 * Normalize an identifier presented by a scanner to exactly one
 * event_registrations row, always scoped to the event being scanned.
 *
 * There are three distinct identifiers in this system, and conflating them is
 * what produced the inconsistent-scanner bug:
 *
 *   1. event_registrations.id           internal UUID (FK target for attendance)
 *   2. event_registrations.registration_id  human code, DSMNRU-<SHORT>-<6>
 *   3. event_registrations.qr_token     64-hex opaque pass, what the QR encodes
 *
 * The QR encodes (3), while a human reading a badge or confirmation email types
 * (2). The scan endpoints only ever matched (3), so the very same participant
 * scanned fine but failed manual entry with INVALID_PASS.
 *
 * SECURITY NOTES — validation is deliberately NOT weakened here:
 *
 *  - event_id is part of every lookup, so a registration belonging to another
 *    event can never be resolved. Cross-event passes stay rejected.
 *  - (2) is matched only against the registration_id column and (3) only
 *    against qr_token. A registration code can never be used as a pass token or
 *    vice versa, and neither is ever compared against the internal UUID (1) —
 *    that identifier is not accepted from clients at all.
 *  - Unknown or fabricated identifiers resolve to nothing and are rejected by
 *    the caller with INVALID_PASS.
 *  - Matching is exact: no prefix, LIKE or fuzzy matching, so nothing can be
 *    enumerated by partial input.
 */
export async function resolveRegistrationForEvent(
  db: D1Database,
  eventId: string,
  rawIdentifier: string
): Promise<ResolvedRegistration | null> {
  const identifier = (rawIdentifier || '').trim();
  if (!identifier) return null;

  // A qr_token is exactly 64 lowercase hex chars (generateOpaqueToken(32)).
  // Registration codes are uppercase with hyphens, so the two forms cannot
  // collide, but we still query each value only against its own column.
  const looksLikeQrToken = /^[0-9a-f]{64}$/i.test(identifier);

  const select =
    'SELECT id, full_name, registration_id, email, college FROM event_registrations WHERE event_id = ?';

  if (looksLikeQrToken) {
    const byToken = await db
      .prepare(`${select} AND qr_token = ?`)
      .bind(eventId, identifier.toLowerCase())
      .first<any>();
    if (byToken) return { ...byToken, matchedBy: 'qr_token' };
    // Fall through: a 64-hex string is not a valid registration code, so there
    // is nothing else to try, but returning null keeps the caller's error path
    // uniform.
    return null;
  }

  // Registration codes are stored uppercase; accept any casing from the
  // operator but compare canonically so "dsmnru-demo-6k8kgu" also works.
  const byCode = await db
    .prepare(`${select} AND UPPER(registration_id) = ?`)
    .bind(eventId, identifier.toUpperCase())
    .first<any>();
  if (byCode) return { ...byCode, matchedBy: 'registration_id' };

  return null;
}

/**
 * Same as resolveRegistrationForEvent but throws the standard INVALID_PASS
 * error when nothing matches, so both scan endpoints behave identically.
 *
 * The message deliberately does not reveal whether the identifier exists under
 * a different event — that would let a scanner probe other events' rosters.
 */
export async function requireRegistrationForEvent(
  db: D1Database,
  eventId: string,
  rawIdentifier: string
): Promise<ResolvedRegistration> {
  const reg = await resolveRegistrationForEvent(db, eventId, rawIdentifier);
  if (!reg) {
    throw new AppError(
      'Invalid event pass: participant not registered for this event',
      'INVALID_PASS',
      404
    );
  }
  return reg;
}
