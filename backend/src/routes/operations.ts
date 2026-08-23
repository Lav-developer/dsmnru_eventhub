import { Hono } from 'hono';
import { requireAuth } from '../utils/auth';
import { AppError } from '../utils/errors';
import { logAudit } from '../utils/audit';
import { rateLimit, limits } from '../utils/rateLimit';
import { HonoTypes, User } from '../types';

const operations = new Hono<HonoTypes>();

// Apply coordinator or volunteer auth to operations
operations.use('*', requireAuth(['super_admin', 'department_head', 'coordinator', 'volunteer']));

// Helper to check scanner permissions for an event
async function checkScannerAuthority(db: D1Database, userId: string, role: string, eventId: string): Promise<boolean> {
  if (role === 'super_admin') return true;

  // Check if coordinator is head of the department
  if (role === 'department_head') {
    const event = await db.prepare('SELECT department_id FROM events WHERE id = ?').bind(eventId).first<{ department_id: string }>();
    if (event) {
      const isDeptHead = await db
        .prepare('SELECT 1 FROM department_members WHERE department_id = ? AND user_id = ?')
        .bind(event.department_id, userId)
        .first();
      if (isDeptHead) return true;
    }
  }

  // Check if assigned to event (as coordinator or volunteer)
  const isAssigned = await db
    .prepare('SELECT 1 FROM event_members WHERE event_id = ? AND user_id = ?')
    .bind(eventId, userId)
    .first();
  return !!isAssigned;
}

// 1. SCAN ATTENDANCE (Strict UNIQUE constraint handles race conditions)
operations.post('/events/:id/attendance/scan', rateLimit('scan', limits.scan), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as User;
  if (!user) {
    throw new AppError('Unauthorized', 'UNAUTHORIZED', 401);
  }
  const eventId = c.req.param('id') || '';
  const body = await c.req.json().catch(() => ({}));
  const { opaque_token, attendance_type = 'event_entry' } = body;

  if (!opaque_token) {
    throw new AppError('Opaque token is missing', 'VALIDATION_ERROR', 400);
  }

  // Check authority
  const hasAuth = await checkScannerAuthority(db, user.id, user.role, eventId);
  if (!hasAuth) {
    throw new AppError('Forbidden: You are not authorized to scan for this event', 'FORBIDDEN', 403);
  }

  // Look up participant from token
  const reg = await db
    .prepare('SELECT id, full_name, registration_id, email, college FROM event_registrations WHERE event_id = ? AND qr_token = ?')
    .bind(eventId, opaque_token)
    .first<any>();

  if (!reg) {
    throw new AppError('Invalid event pass: participant not registered for this event', 'INVALID_PASS', 404);
  }

  try {
    const attendanceId = crypto.randomUUID();
    // Unique constraint on (event_id, registration_id, attendance_type) guarantees safety
    await db
      .prepare(
        `INSERT INTO attendance (id, event_id, registration_id, scanner_id, attendance_type)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(attendanceId, eventId, reg.id, user.id, attendance_type)
      .run();

    return c.json({
      success: true,
      data: {
        status: 'GREEN',
        message: 'Attendance recorded successfully!',
        participant: {
          name: reg.full_name,
          registrationId: reg.registration_id,
          college: reg.college
        }
      }
    });
  } catch (err: any) {
    // Catch unique constraint violation
    if (err.message && (err.message.includes('UNIQUE') || err.message.includes('constraint failed'))) {
      return c.json(
        {
          success: false,
          error: {
            code: 'ALREADY_CLAIMED',
            message: 'Already checked in.',
            status: 'YELLOW',
            participant: {
              name: reg.full_name,
              registrationId: reg.registration_id
            }
          }
        },
        409
      );
    }

    throw err;
  }
});

// 2. CREATE RESOURCE CONFIGURATION
operations.post('/events/:id/resources', async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as User;
  if (!user) {
    throw new AppError('Unauthorized', 'UNAUTHORIZED', 401);
  }
  const eventId = c.req.param('id') || '';
  const body = await c.req.json().catch(() => ({}));
  const { name, quantity, eligibility = 'all', claim_limit = 1 } = body;

  if (user.role === 'volunteer') {
    throw new AppError('Forbidden: Volunteers cannot modify event configurations', 'FORBIDDEN', 403);
  }

  const hasAuth = await checkScannerAuthority(db, user.id, user.role, eventId);
  if (!hasAuth) {
    throw new AppError('Forbidden: Access denied', 'FORBIDDEN', 403);
  }

  if (!name || !quantity) {
    throw new AppError('Missing resource name or quantity', 'VALIDATION_ERROR', 400);
  }

  const resourceId = crypto.randomUUID();
  try {
    await db
      .prepare(
        `INSERT INTO resources (id, event_id, name, quantity, eligibility, claim_limit, status)
         VALUES (?, ?, ?, ?, ?, ?, 'active')`
      )
      .bind(resourceId, eventId, name, quantity, eligibility, claim_limit)
      .run();

    await logAudit(
      db,
      user.id,
      user.email,
      'CREATE_RESOURCE',
      'resource',
      resourceId,
      { eventId, name, quantity },
      c.req.header('CF-Connecting-IP')
    );

    return c.json({
      success: true,
      data: { id: resourceId, name, quantity, eligibility, claim_limit }
    });
  } catch (err: any) {
    if (err.message && (err.message.includes('UNIQUE') || err.message.includes('constraint failed'))) {
      throw new AppError(`A resource named "${name}" already exists for this event`, 'CONFLICT', 409);
    }
    throw err;
  }
});

// 3. LIST RESOURCES WITH REMAINING COUNTS (Dynamic dynamic calculation)
operations.get('/events/:id/resources', async (c) => {
  const db = c.env.DB;
  const eventId = c.req.param('id') || '';

  const list = await db
    .prepare(
      `SELECT r.*,
              (SELECT COUNT(*) FROM resource_claims WHERE resource_id = r.id) as claimed_count
       FROM resources r
       WHERE r.event_id = ?`
    )
    .bind(eventId)
    .all<any>();

  const resourcesWithStats = (list.results || []).map((r: any) => ({
    ...r,
    remaining: Math.max(0, r.quantity - r.claimed_count)
  }));

  return c.json({
    success: true,
    data: resourcesWithStats
  });
});

// 4. SCAN RESOURCE / FOOD CLAIM (Uniqueness, concurrency-safe, dynamic capacity-safe)
operations.post('/events/:id/resources/:resourceId/scan', rateLimit('scan', limits.scan), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as User;
  if (!user) {
    throw new AppError('Unauthorized', 'UNAUTHORIZED', 401);
  }
  const eventId = c.req.param('id') || '';
  const resourceId = c.req.param('resourceId') || '';
  const body = await c.req.json().catch(() => ({}));
  const { opaque_token } = body;

  if (!opaque_token) {
    throw new AppError('Opaque token is missing', 'VALIDATION_ERROR', 400);
  }

  const hasAuth = await checkScannerAuthority(db, user.id, user.role, eventId);
  if (!hasAuth) {
    throw new AppError('Forbidden: Access denied', 'FORBIDDEN', 403);
  }

  // Fetch resource and evaluate remaining counts on the fly
  const resource = await db
    .prepare(
      `SELECT r.*,
              (SELECT COUNT(*) FROM resource_claims WHERE resource_id = r.id) as claimed_count
       FROM resources r
       WHERE r.id = ? AND r.event_id = ?`
    )
    .bind(resourceId, eventId)
    .first<any>();

  if (!resource) {
    throw new AppError('Resource configuration not found', 'NOT_FOUND', 404);
  }

  if (resource.status !== 'active') {
    throw new AppError('This resource is currently marked inactive', 'RESOURCE_INACTIVE', 400);
  }

  // Look up participant from opaque revocable qr_token
  const reg = await db
    .prepare('SELECT id, full_name, registration_id, email, college FROM event_registrations WHERE event_id = ? AND qr_token = ?')
    .bind(eventId, opaque_token)
    .first<any>();

  if (!reg) {
    throw new AppError('Invalid event pass: participant not registered for this event', 'INVALID_PASS', 404);
  }

  // If eligibility is 'attendees', check if they have checked in
  if (resource.eligibility === 'attendees') {
    const isAttended = await db
      .prepare("SELECT 1 FROM attendance WHERE event_id = ? AND registration_id = ? AND attendance_type = 'event_entry'")
      .bind(eventId, reg.id)
      .first();

    if (!isAttended) {
      throw new AppError('Participant has not checked in for this event yet.', 'ELIGIBILITY_REQUIRED', 400);
    }
  }

  try {
    const claimId = crypto.randomUUID();
    // Unique constraint on (event_id, registration_id, resource_id) guarantees safety.
    // Subquery inside atomic INSERT SELECT statement check guarantees quantity limits are never exceeded under high-concurrency race conditions.
    const result = await db
      .prepare(
        `INSERT INTO resource_claims (id, event_id, registration_id, resource_id, scanner_id)
         SELECT ?, ?, ?, ?, ?
         WHERE (
           SELECT COUNT(*) FROM resource_claims WHERE resource_id = ?
         ) < (
           SELECT quantity FROM resources WHERE id = ? AND status = 'active'
         )`
      )
      .bind(claimId, eventId, reg.id, resourceId, user.id, resourceId, resourceId)
      .run();

    if (result.meta.changes === 0) {
      throw new AppError(`Resource "${resource.name}" has been fully claimed (0 remaining).`, 'RESOURCE_EXHAUSTED', 400);
    }

    return c.json({
      success: true,
      data: {
        status: 'GREEN',
        message: `${resource.name} claimed successfully!`,
        participant: {
          name: reg.full_name,
          registrationId: reg.registration_id
        }
      }
    });
  } catch (err: any) {
    if (err.message && (err.message.includes('UNIQUE') || err.message.includes('constraint failed'))) {
      return c.json(
        {
          success: false,
          error: {
            code: 'ALREADY_CLAIMED',
            message: `Already claimed ${resource.name}.`,
            status: 'YELLOW',
            participant: {
              name: reg.full_name,
              registrationId: reg.registration_id
            }
          }
        },
        409
      );
    }

    throw err;
  }
});

// 5. LIVE ATTENDANCE & RESOURCE DASHBOARD
operations.get('/events/:id/dashboard', async (c) => {
  const db = c.env.DB;
  const eventId = c.req.param('id') || '';

  // Stats query
  const stats = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM event_registrations WHERE event_id = ?) as registered_count,
         (SELECT COUNT(*) FROM attendance WHERE event_id = ? AND attendance_type = 'event_entry') as attended_count`
    )
    .bind(eventId, eventId)
    .first<any>();

  const registered = stats?.registered_count || 0;
  const attended = stats?.attended_count || 0;
  const absent = Math.max(0, registered - attended);

  // Recent 10 attendance scans
  const recentAttendance = await db
    .prepare(
      `SELECT a.timestamp, r.full_name, r.registration_id, u.full_name as scanner_name
       FROM attendance a
       JOIN event_registrations r ON a.registration_id = r.id
       LEFT JOIN users u ON a.scanner_id = u.id
       WHERE a.event_id = ? AND a.attendance_type = 'event_entry'
       ORDER BY a.timestamp DESC LIMIT 10`
    )
    .bind(eventId)
    .all<any>();

  return c.json({
    success: true,
    data: {
      registered,
      attended,
      absent,
      recentScans: recentAttendance.results || []
    }
  });
});

export default operations;
export { checkScannerAuthority };
