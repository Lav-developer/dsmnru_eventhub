import { Hono } from 'hono';
import { requireAuth } from '../utils/auth';
import { AppError } from '../utils/errors';
import { logAudit } from '../utils/audit';
import { rateLimit, limits } from '../utils/rateLimit';
import { generateShortId } from '../utils/crypto';
import { checkEventAuthority } from './events';
import { HonoTypes, User } from '../types';

const certificates = new Hono<HonoTypes>();

// 1. PUBLIC ENDPOINT: Certificate Verification (Rate-limited, no auth)
certificates.get('/verify/:certificateId', rateLimit('verification', limits.verification), async (c) => {
  const db = c.env.DB;
  const certificateId = c.req.param('certificateId');

  const cert = await db
    .prepare(
      `SELECT cr.id as certificate_id, cr.participant_name, cr.certificate_type, cr.issued_at,
              e.name as event_name, e.short_name as event_short_name, e.start_date,
              d.name as department_name
       FROM certificate_records cr
       JOIN events e ON cr.event_id = e.id
       LEFT JOIN departments d ON e.department_id = d.id
       WHERE cr.id = ?`
    )
    .bind(certificateId)
    .first<any>();

  if (!cert) {
    return c.json({
      success: true,
      data: {
        verified: false,
        message: 'This certificate ID could not be verified. It may be invalid or forged.'
      }
    });
  }

  return c.json({
    success: true,
    data: {
      verified: true,
      certificateId: cert.certificate_id,
      participantName: cert.participant_name,
      certificateType: cert.certificate_type,
      issuedAt: cert.issued_at,
      eventName: cert.event_name,
      eventShortName: cert.event_short_name,
      eventStartDate: cert.start_date,
      departmentName: cert.department_name
    }
  });
});

// 2. COORDINATOR ENDPOINT: Save/Create Event Certificate Template
certificates.post('/events/:id/templates', requireAuth(['super_admin', 'department_head', 'coordinator']), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as User;
  if (!user) {
    throw new AppError('Unauthorized', 'UNAUTHORIZED', 401);
  }
  const eventId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const { name, bg_image_url, layout_json, certificate_type } = body;

  const hasAuth = await checkEventAuthority(db, user.id, user.role, eventId);
  if (!hasAuth) {
    throw new AppError('Forbidden: Access denied', 'FORBIDDEN', 403);
  }

  if (!name || !layout_json || !certificate_type) {
    throw new AppError('Missing required template details', 'VALIDATION_ERROR', 400);
  }

  const templateId = crypto.randomUUID();
  try {
    await db
      .prepare(
        `INSERT INTO event_certificate_templates (id, event_id, name, bg_image_url, layout_json, certificate_type)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(templateId, eventId, name, bg_image_url || null, JSON.stringify(layout_json), certificate_type)
      .run();

    await logAudit(
      db,
      user.id,
      user.email,
      'CREATE_CERTIFICATE_TEMPLATE',
      'certificate_template',
      templateId,
      { eventId, certificate_type },
      c.req.header('CF-Connecting-IP')
    );

    return c.json({
      success: true,
      data: { id: templateId, name, certificate_type }
    });
  } catch (err: any) {
    if (err.message && (err.message.includes('UNIQUE') || err.message.includes('constraint failed'))) {
      // Update instead of insert if template for this certificate_type already exists
      await db
        .prepare(
          `UPDATE event_certificate_templates
           SET name = ?, bg_image_url = ?, layout_json = ?, created_at = datetime('now')
           WHERE event_id = ? AND certificate_type = ?`
        )
        .bind(name, bg_image_url || null, JSON.stringify(layout_json), eventId, certificate_type)
        .run();

      return c.json({
        success: true,
        data: { message: 'Template updated successfully' }
      });
    }
    throw err;
  }
});

// 3. COORDINATOR ENDPOINT: List certificate templates for an event
certificates.get('/events/:id/templates', requireAuth(['super_admin', 'department_head', 'coordinator']), async (c) => {
  const db = c.env.DB;
  const eventId = c.req.param('id');

  const list = await db
    .prepare('SELECT id, name, bg_image_url, layout_json, certificate_type, created_at FROM event_certificate_templates WHERE event_id = ?')
    .bind(eventId)
    .all<any>();

  const results = (list.results || []).map((t: any) => ({
    ...t,
    layout_json: JSON.parse(t.layout_json)
  }));

  return c.json({
    success: true,
    data: results
  });
});

// 4. COORDINATOR ENDPOINT: Bulk Issue Certificates Metadata (Never uploads PDF files, just stores metadata)
certificates.post('/events/:id/issue', requireAuth(['super_admin', 'department_head', 'coordinator']), rateLimit('csv', limits.csv), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as User;
  if (!user) {
    throw new AppError('Unauthorized', 'UNAUTHORIZED', 401);
  }
  const eventId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const { participants, certificate_type } = body; // Array of { registration_id, full_name }

  const hasAuth = await checkEventAuthority(db, user.id, user.role, eventId);
  if (!hasAuth) {
    throw new AppError('Forbidden: Access denied', 'FORBIDDEN', 403);
  }

  if (!participants || !Array.isArray(participants) || participants.length === 0 || !certificate_type) {
    throw new AppError('Invalid participants list or certificate type', 'VALIDATION_ERROR', 400);
  }

  const currentYear = new Date().getFullYear();
  const issuedList: any[] = [];

  for (const p of participants) {
    const regId = p.registration_id;
    const name = p.full_name;

    // Check if participant exists in event
    const reg = await db
      .prepare('SELECT id FROM event_registrations WHERE event_id = ? AND registration_id = ?')
      .bind(eventId, regId)
      .first<any>();

    if (!reg) continue; // Skip invalid records

    // Check if already issued
    const alreadyIssued = await db
      .prepare('SELECT id FROM certificate_records WHERE event_id = ? AND registration_id = ? AND certificate_type = ?')
      .bind(eventId, reg.id, certificate_type)
      .first<any>();

    if (alreadyIssued) {
      issuedList.push({
        registration_id: regId,
        certificate_id: alreadyIssued.id,
        status: 'ALREADY_ISSUED'
      });
      continue;
    }

    // Generate unique certificate ID: DSMNRU-YYYY-8CHAR
    const certId = `DSMNRU-${currentYear}-${generateShortId(8)}`;
    await db
      .prepare(
        `INSERT INTO certificate_records (id, event_id, registration_id, participant_name, certificate_type)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(certId, eventId, reg.id, name, certificate_type)
      .run();

    issuedList.push({
      registration_id: regId,
      certificate_id: certId,
      status: 'ISSUED'
    });
  }

  await logAudit(
    db,
    user.id,
    user.email,
    'ISSUE_CERTIFICATES',
    'certificate',
    eventId,
    { count: issuedList.length, certificate_type },
    c.req.header('CF-Connecting-IP')
  );

  return c.json({
    success: true,
    data: issuedList
  });
});

// 5. COORDINATOR ENDPOINT: List all issued certificate records for event
certificates.get('/events/:id/issued', requireAuth(['super_admin', 'department_head', 'coordinator']), async (c) => {
  const db = c.env.DB;
  const eventId = c.req.param('id');
  const page = parseInt(c.req.query('page') || '1', 10);
  const limit = parseInt(c.req.query('limit') || '50', 10);

  const offset = (page - 1) * limit;

  const countRes = await db
    .prepare('SELECT COUNT(*) as count FROM certificate_records WHERE event_id = ?')
    .bind(eventId)
    .first<{ count: number }>();
  const total = countRes?.count || 0;

  const list = await db
    .prepare(
      `SELECT cr.id as certificate_id, cr.participant_name, cr.certificate_type, cr.issued_at,
              r.registration_id, r.email
       FROM certificate_records cr
       JOIN event_registrations r ON cr.registration_id = r.id
       WHERE cr.event_id = ?
       ORDER BY cr.issued_at DESC
       LIMIT ? OFFSET ?`
    )
    .bind(eventId, limit, offset)
    .all<any>();

  return c.json({
    success: true,
    data: {
      records: list.results || [],
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    }
  });
});

export default certificates;
