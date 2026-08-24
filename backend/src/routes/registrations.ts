import { Hono } from 'hono';
import { requireAuth } from '../utils/auth';
import { AppError } from '../utils/errors';
import { logAudit } from '../utils/audit';
import { rateLimit, limits } from '../utils/rateLimit';
import { formatCSV } from '../utils/csv';
import { checkEventAuthority } from './events';
import { HonoTypes, User } from '../types';
import { generateShortId, generateOpaqueToken } from '../utils/crypto';
import { sendRegistrationConfirmationEmail } from '../utils/registrationEmail';

const registrations = new Hono<HonoTypes>();

// Helper to validate email format
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Collision-safe, randomized registration_id generator
async function generateRegistrationSeqId(shortName: string): Promise<string> {
  const prefix = shortName.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const suffix = generateShortId(6);
  return `DSMNRU-${prefix}-${suffix}`;
}

// 1. PUBLIC ENDPOINT: Built-in registration creation (Harden for concurrent races & input validation)
registrations.post('/events/:id/register', rateLimit('registration', limits.registration), async (c) => {
  const db = c.env.DB;
  const eventId = c.req.param('id') || '';
  const body = await c.req.json().catch(() => ({}));

  // Fetch event details
  const event = await db
    .prepare(
      `SELECT id, name, short_name, status, registration_type, start_date, end_date,
              start_time, end_time, venue, format, meeting_link
       FROM events WHERE id = ?`
    )
    .bind(eventId)
    .first<any>();

  if (!event) {
    throw new AppError('Event not found', 'NOT_FOUND', 404);
  }

  if (event.status !== 'REGISTRATION_OPEN') {
    throw new AppError('Registration is not currently open for this event.', 'REGISTRATION_CLOSED', 400);
  }

  if (event.registration_type !== 'built_in') {
    throw new AppError('This event uses an external registration form.', 'BAD_REQUEST', 400);
  }

  // Extract primary fields with strict limits to prevent spam
  const { full_name, email, phone, college, department, course, year, designation, custom_responses } = body;

  if (!full_name || !email || !phone || !college || !department || !course || !year || !designation) {
    throw new AppError('Missing required registration fields', 'VALIDATION_ERROR', 400);
  }

  if (full_name.length > 100 || email.length > 100 || phone.length > 30 || college.length > 150) {
    throw new AppError('Oversized input fields detected', 'VALIDATION_ERROR', 400);
  }

  if (!isValidEmail(email)) {
    throw new AppError('Invalid email format', 'VALIDATION_ERROR', 400);
  }

  // Check unique email for this event
  const alreadyRegistered = await db
    .prepare('SELECT id FROM event_registrations WHERE event_id = ? AND email = ?')
    .bind(eventId, email.toLowerCase())
    .first();

  if (alreadyRegistered) {
    throw new AppError('You are already registered for this event', 'DUPLICATE_REGISTRATION', 409);
  }

  // Load custom fields to validate
  const customFields = await db
    .prepare('SELECT id, label, required, field_type, options FROM registration_fields WHERE event_id = ? ORDER BY field_order ASC')
    .bind(eventId)
    .all<any>();

  const responsesToInsert: { fieldId: string; value: string }[] = [];

  if (customFields.results) {
    for (const f of customFields.results) {
      const respVal = custom_responses?.[f.id];
      if (f.required && (respVal === undefined || respVal === null || String(respVal).trim() === '')) {
        throw new AppError(`Missing required custom field: ${f.label}`, 'VALIDATION_ERROR', 400);
      }
      if (respVal !== undefined && respVal !== null) {
        if (String(respVal).length > 500) {
          throw new AppError(`Custom field response for ${f.label} is too long`, 'VALIDATION_ERROR', 400);
        }
        responsesToInsert.push({
          fieldId: f.id,
          value: String(respVal)
        });
      }
    }
  }

  // Generate opaque token for QR Code
  const id = crypto.randomUUID();
  const qrToken = generateOpaqueToken(32);
  let registrationId = '';
  let insertSuccess = false;
  let attempts = 0;

  // Insert registration details with retry on registration ID collision
  while (!insertSuccess && attempts < 3) {
    attempts++;
    registrationId = await generateRegistrationSeqId(event.short_name);
    try {
      await db
        .prepare(
          `INSERT INTO event_registrations (id, event_id, registration_id, full_name, email, phone, college, department, course, year, designation, qr_token)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          id,
          eventId,
          registrationId,
          full_name,
          email.toLowerCase(),
          phone,
          college,
          department,
          course,
          year,
          designation,
          qrToken
        )
        .run();
      insertSuccess = true;
    } catch (err: any) {
      const errMsg = err.message || '';
      if (errMsg.includes('UNIQUE') || errMsg.includes('constraint failed')) {
        if (errMsg.includes('email')) {
          throw new AppError('You are already registered for this event', 'DUPLICATE_REGISTRATION', 409);
        }
        continue; // Retry on registration_id collision
      }
      throw err;
    }
  }

  if (!insertSuccess) {
    throw new AppError('Registration failed due to a system collision. Please try again.', 'REGISTRATION_FAILED', 500);
  }

  // Insert custom responses
  if (responsesToInsert.length > 0) {
    for (const resp of responsesToInsert) {
      await db
        .prepare(
          `INSERT INTO registration_responses (id, registration_id, field_id, value)
           VALUES (?, ?, ?, ?)`
        )
        .bind(crypto.randomUUID(), id, resp.fieldId, resp.value)
        .run();
    }
  }

  await logAudit(
    db,
    null,
    null,
    'PARTICIPANT_REGISTER',
    'registration',
    id,
    { eventId, registrationId, email: email.toLowerCase() },
    c.req.header('CF-Connecting-IP')
  );

  // Confirmation email is best-effort and MUST NOT affect the HTTP result:
  // the registration is already committed, so a mail outage must never be
  // reported to the participant as a failed registration. Failures are logged
  // to email_logs for operators to retry.
  c.executionCtx?.waitUntil?.(
    sendRegistrationConfirmationEmail(c.env, {
      eventId,
      eventName: event.name,
      registrationId,
      fullName: full_name,
      email: email.toLowerCase(),
      qrToken,
      startDate: event.start_date,
      startTime: event.start_time,
      endTime: event.end_time,
      venue: event.venue,
      format: event.format
    })
  );

  return c.json({
    success: true,
    data: {
      id: qrToken, // Truly opaque revocable pass token (never exposes internal record UUID)
      registrationId,
      full_name,
      email: email.toLowerCase(),
      phone,
      college,
      // Event details for the confirmation screen, so it can show what/when/
      // where without a second round trip.
      event: {
        id: event.id,
        name: event.name,
        short_name: event.short_name,
        start_date: event.start_date,
        end_date: event.end_date,
        start_time: event.start_time,
        end_time: event.end_time,
        venue: event.venue,
        format: event.format,
        meeting_link: event.format === 'offline' ? null : event.meeting_link
      }
    }
  });
});

// 1b. PUBLIC: Retrieve a pass by its opaque token.
//
// The token is the credential: it is a 32-byte server-generated random value
// (never a participant id, email or any other client-controlled value), so it
// cannot be guessed or enumerated, and knowing a participant's name or
// registration id does not let anyone fetch their pass. Rate limited to blunt
// brute-force attempts. Returns only what the pass screen needs to render —
// never phone, college, course or custom answers.
registrations.get('/pass/:token', rateLimit('verification', limits.verification), async (c) => {
  const db = c.env.DB;
  const token = c.req.param('token') || '';

  if (!token || token.length < 16) {
    throw new AppError('Invalid pass link', 'INVALID_PASS', 404);
  }

  const reg = await db
    .prepare(
      `SELECT r.registration_id, r.full_name, r.qr_token,
              e.id AS event_id, e.name AS event_name, e.short_name,
              e.start_date, e.end_date, e.start_time, e.end_time,
              e.venue, e.format, e.meeting_link
       FROM event_registrations r
       JOIN events e ON e.id = r.event_id
       WHERE r.qr_token = ?`
    )
    .bind(token)
    .first<any>();

  if (!reg) {
    throw new AppError('This pass link is not valid or has been revoked.', 'INVALID_PASS', 404);
  }

  return c.json({
    success: true,
    data: {
      id: reg.qr_token,
      registrationId: reg.registration_id,
      full_name: reg.full_name,
      event: {
        id: reg.event_id,
        name: reg.event_name,
        short_name: reg.short_name,
        start_date: reg.start_date,
        end_date: reg.end_date,
        start_time: reg.start_time,
        end_time: reg.end_time,
        venue: reg.venue,
        format: reg.format,
        meeting_link: reg.format === 'offline' ? null : reg.meeting_link
      }
    }
  });
});

// 2. COORDINATOR ENDPOINT: List/Search registrations
registrations.get('/events/:id/registrations', requireAuth(['super_admin', 'department_head', 'coordinator']), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as User;
  if (!user) {
    throw new AppError('Unauthorized', 'UNAUTHORIZED', 401);
  }
  const eventId = c.req.param('id') || '';

  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '20', 10)));
  const search = c.req.query('search') || '';

  const offset = (page - 1) * limit;

  const hasAuth = await checkEventAuthority(db, user.id, user.role, eventId);
  if (!hasAuth) {
    throw new AppError('Forbidden: Access denied', 'FORBIDDEN', 403);
  }

  let query = 'SELECT id, registration_id, full_name, email, phone, college, department, course, year, designation, created_at FROM event_registrations WHERE event_id = ?';
  let countQuery = 'SELECT COUNT(*) as count FROM event_registrations WHERE event_id = ?';
  const params: any[] = [eventId];
  const countParams: any[] = [eventId];

  if (search) {
    const pattern = `%${search}%`;
    query += ' AND (full_name LIKE ? OR email LIKE ? OR registration_id LIKE ? OR college LIKE ?)';
    countQuery += ' AND (full_name LIKE ? OR email LIKE ? OR registration_id LIKE ? OR college LIKE ?)';
    params.push(pattern, pattern, pattern, pattern);
    countParams.push(pattern, pattern, pattern, pattern);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const [regs, totalResult] = await Promise.all([
    db.prepare(query).bind(...params).all<any>(),
    db.prepare(countQuery).bind(...countParams).first<{ count: number }>()
  ]);

  const total = totalResult ? totalResult.count : 0;

  return c.json({
    success: true,
    data: {
      registrations: regs.results || [],
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    }
  });
});

// 3. COORDINATOR ENDPOINT: CSV Import Preview & Stats Analysis (Show changes before applying)
registrations.post('/events/:id/registrations/import-preview', requireAuth(['super_admin', 'department_head', 'coordinator']), rateLimit('csv', limits.csv), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as User;
  if (!user) {
    throw new AppError('Unauthorized', 'UNAUTHORIZED', 401);
  }
  const eventId = c.req.param('id') || '';
  
  const hasAuth = await checkEventAuthority(db, user.id, user.role, eventId);
  if (!hasAuth) {
    throw new AppError('Forbidden: Access denied', 'FORBIDDEN', 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const { participants } = body;

  if (!participants || !Array.isArray(participants)) {
    throw new AppError('Missing or invalid participants payload', 'VALIDATION_ERROR', 400);
  }

  // Prevent memory overload on workers
  if (participants.length > 1000) {
    throw new AppError('Import payload exceeds maximum limit of 1000 records', 'VALIDATION_ERROR', 400);
  }

  // Get existing registrations for this event to identify duplicates vs updates
  const existingRegsList = await db
    .prepare('SELECT id, email, registration_id, full_name, college FROM event_registrations WHERE event_id = ?')
    .bind(eventId)
    .all<any>();

  const existingMapByEmail = new Map<string, any>();
  if (existingRegsList.results) {
    for (const r of existingRegsList.results) {
      existingMapByEmail.set(r.email.toLowerCase(), r);
    }
  }

  const stats = {
    total: participants.length,
    newCount: 0,
    updatedCount: 0,
    duplicateCount: 0,
    rejectedCount: 0,
    preview: {
      newRows: [] as any[],
      updatedRows: [] as any[],
      rejectedRows: [] as any[]
    }
  };

  for (let idx = 0; idx < participants.length; idx++) {
    const p = participants[idx];
    const email = p.email ? String(p.email).toLowerCase().trim() : '';

    if (!p.full_name || !email) {
      stats.rejectedCount++;
      if (stats.preview.rejectedRows.length < 10) {
        stats.preview.rejectedRows.push({
          rowNumber: idx + 2,
          raw: p,
          reason: 'Missing Name or Email'
        });
      }
      continue;
    }

    if (!isValidEmail(email)) {
      stats.rejectedCount++;
      if (stats.preview.rejectedRows.length < 10) {
        stats.preview.rejectedRows.push({
          rowNumber: idx + 2,
          raw: p,
          reason: 'Invalid Email Address'
        });
      }
      continue;
    }

    const existing = existingMapByEmail.get(email);
    if (existing) {
      const isIdentical =
        existing.full_name.toLowerCase() === String(p.full_name).toLowerCase() &&
        existing.college.toLowerCase() === String(p.college || '').toLowerCase();

      if (isIdentical) {
        stats.duplicateCount++;
      } else {
        stats.updatedCount++;
        if (stats.preview.updatedRows.length < 10) {
          stats.preview.updatedRows.push({
            rowNumber: idx + 2,
            registration_id: existing.registration_id,
            email,
            originalName: existing.full_name,
            newName: p.full_name
          });
        }
      }
    } else {
      stats.newCount++;
      if (stats.preview.newRows.length < 10) {
        stats.preview.newRows.push({
          rowNumber: idx + 2,
          email,
          name: p.full_name
        });
      }
    }
  }

  return c.json({
    success: true,
    data: {
      total: stats.total,
      newCount: stats.newCount,
      updatedCount: stats.updatedCount,
      duplicateCount: stats.duplicateCount,
      rejectedCount: stats.rejectedCount,
      preview: stats.preview
    }
  });
});

// 4. COORDINATOR ENDPOINT: CSV Import Apply Transaction (Repeated import safe & lightweight JSON payload)
registrations.post('/events/:id/registrations/import-commit', requireAuth(['super_admin', 'department_head', 'coordinator']), rateLimit('csv', limits.csv), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as User;
  if (!user) {
    throw new AppError('Unauthorized', 'UNAUTHORIZED', 401);
  }
  const eventId = c.req.param('id') || '';

  const hasAuth = await checkEventAuthority(db, user.id, user.role, eventId);
  if (!hasAuth) {
    throw new AppError('Forbidden: Access denied', 'FORBIDDEN', 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const { participants, filename } = body;

  if (!participants || !Array.isArray(participants) || !filename) {
    throw new AppError('Missing required arguments', 'VALIDATION_ERROR', 400);
  }

  if (participants.length > 1000) {
    throw new AppError('Import payload exceeds maximum limit of 1000 records', 'VALIDATION_ERROR', 400);
  }

  const event = await db.prepare('SELECT short_name FROM events WHERE id = ?').bind(eventId).first<{ short_name: string }>();
  if (!event) {
    throw new AppError('Event not found', 'NOT_FOUND', 404);
  }

  // Pre-load existing registrations map
  const existingRegsList = await db
    .prepare('SELECT id, email, registration_id, full_name, college FROM event_registrations WHERE event_id = ?')
    .bind(eventId)
    .all<any>();

  const existingMapByEmail = new Map<string, any>();
  if (existingRegsList.results) {
    for (const r of existingRegsList.results) {
      existingMapByEmail.set(r.email.toLowerCase(), r);
    }
  }

  const importId = crypto.randomUUID();
  let inserted = 0;
  let updated = 0;
  let duplicates = 0;
  let rejected = 0;

  const errorsList: { rowNumber: number; raw: any; reason: string }[] = [];

  // Start processing rows
  for (let idx = 0; idx < participants.length; idx++) {
    const p = participants[idx];
    const email = p.email ? String(p.email).toLowerCase().trim() : '';

    if (!p.full_name || !email) {
      rejected++;
      errorsList.push({ rowNumber: idx + 2, raw: p, reason: 'Missing Name or Email' });
      continue;
    }

    if (!isValidEmail(email)) {
      rejected++;
      errorsList.push({ rowNumber: idx + 2, raw: p, reason: 'Invalid Email Address' });
      continue;
    }

    const existing = existingMapByEmail.get(email);
    try {
      if (existing) {
        const isIdentical =
          existing.full_name.toLowerCase() === String(p.full_name).toLowerCase() &&
          existing.college.toLowerCase() === String(p.college || '').toLowerCase();

        if (isIdentical) {
          duplicates++;
        } else {
          // Update existing details, preserving registration_id
          await db
            .prepare(
              `UPDATE event_registrations
               SET full_name = ?, phone = ?, college = ?, department = ?, course = ?, year = ?, designation = ?
               WHERE id = ?`
            )
            .bind(
              String(p.full_name).substring(0, 100),
              String(p.phone || 'N/A').substring(0, 30),
              String(p.college || 'N/A').substring(0, 150),
              String(p.department || 'N/A').substring(0, 150),
              String(p.course || 'N/A').substring(0, 100),
              String(p.year || 'N/A').substring(0, 30),
              String(p.designation || 'Student').substring(0, 50),
              existing.id
            )
            .run();
          updated++;
        }
      } else {
        // Insert new registration with collision protection
        const id = crypto.randomUUID();
        const qrToken = generateOpaqueToken(32);
        let registrationId = '';
        let insertSuccess = false;
        let attempts = 0;

        while (!insertSuccess && attempts < 3) {
          attempts++;
          registrationId = await generateRegistrationSeqId(event.short_name);
          try {
            await db
              .prepare(
                `INSERT INTO event_registrations (id, event_id, registration_id, full_name, email, phone, college, department, course, year, designation, qr_token)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              )
              .bind(
                id,
                eventId,
                registrationId,
                String(p.full_name).substring(0, 100),
                email,
                String(p.phone || 'N/A').substring(0, 30),
                String(p.college || 'N/A').substring(0, 150),
                String(p.department || 'N/A').substring(0, 150),
                String(p.course || 'N/A').substring(0, 100),
                String(p.year || 'N/A').substring(0, 30),
                String(p.designation || 'Student').substring(0, 50),
                qrToken
              )
              .run();
            insertSuccess = true;
          } catch (err: any) {
            const errMsg = err.message || '';
            if (errMsg.includes('UNIQUE') || errMsg.includes('constraint failed')) {
              if (errMsg.includes('email')) {
                throw new Error('Email already exists');
              }
              continue; // Retry on registrationId collision
            }
            throw err;
          }
        }

        if (!insertSuccess) {
          throw new Error('System collision on registration ID');
        }
        inserted++;
      }
    } catch (err: any) {
      rejected++;
      errorsList.push({ rowNumber: idx + 2, raw: p, reason: err.message || 'System error' });
    }
  }

  // Record import history
  await db
    .prepare(
      `INSERT INTO registration_imports (id, event_id, uploader_id, filename, row_count, inserted_count, updated_count, duplicate_count, rejected_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(importId, eventId, user.id, String(filename).substring(0, 255), participants.length, inserted, updated, duplicates, rejected)
    .run();

  // Log failures/errors if any
  if (errorsList.length > 0) {
    for (const errRow of errorsList) {
      await db
        .prepare(
          `INSERT INTO registration_import_errors (id, import_id, row_number, raw_data, error_reason)
           VALUES (?, ?, ?, ?, ?)`
        )
        .bind(crypto.randomUUID(), importId, errRow.rowNumber, JSON.stringify(errRow.raw), errRow.reason)
        .run();
    }
  }

  await logAudit(
    db,
    user.id,
    user.email,
    'IMPORT_CSV_REGISTRATIONS',
    'registration',
    importId,
    { eventId, filename, inserted, updated, duplicates, rejected },
    c.req.header('CF-Connecting-IP')
  );

  return c.json({
    success: true,
    data: {
      importId,
      totalProcessed: participants.length,
      inserted,
      updated,
      duplicates,
      rejected,
      hasErrors: rejected > 0
    }
  });
});

// 5. COORDINATOR ENDPOINT: CSV Export Registrations (Includes OWASP injection protection)
registrations.get('/events/:id/registrations/export', requireAuth(['super_admin', 'department_head', 'coordinator']), rateLimit('csv', limits.csv), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as User;
  if (!user) {
    throw new AppError('Unauthorized', 'UNAUTHORIZED', 401);
  }
  const eventId = c.req.param('id') || '';

  const hasAuth = await checkEventAuthority(db, user.id, user.role, eventId);
  if (!hasAuth) {
    throw new AppError('Forbidden: Access denied', 'FORBIDDEN', 403);
  }

  const regs = await db
    .prepare(
      `SELECT registration_id, full_name, email, phone, college, department, course, year, designation, created_at
       FROM event_registrations
       WHERE event_id = ?
       ORDER BY registration_id ASC`
    )
    .bind(eventId)
    .all<any>();

  const list = regs.results || [];
  const headers = ['registration_id', 'full_name', 'email', 'phone', 'college', 'department', 'course', 'year', 'designation', 'created_at'];

  const csvContent = formatCSV(headers, list);

  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', `attachment; filename="event_${eventId}_registrations.csv"`);
  return c.text(csvContent);
});

// 6. COORDINATOR ENDPOINT: Delete / Cancel registration
registrations.delete('/events/:id/registrations/:regId', requireAuth(['super_admin', 'department_head', 'coordinator']), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as User;
  if (!user) {
    throw new AppError('Unauthorized', 'UNAUTHORIZED', 401);
  }
  const eventId = c.req.param('id') || '';
  const regId = c.req.param('regId') || '';

  const hasAuth = await checkEventAuthority(db, user.id, user.role, eventId);
  if (!hasAuth) {
    throw new AppError('Forbidden: Access denied', 'FORBIDDEN', 403);
  }

  const exists = await db
    .prepare('SELECT id, full_name, email FROM event_registrations WHERE event_id = ? AND id = ?')
    .bind(eventId, regId)
    .first<any>();

  if (!exists) {
    throw new AppError('Registration record not found', 'NOT_FOUND', 404);
  }

  await db.prepare('DELETE FROM event_registrations WHERE id = ?').bind(regId).run();

  await logAudit(
    db,
    user.id,
    user.email,
    'DELETE_REGISTRATION',
    'registration',
    regId,
    { eventId, participantName: exists.full_name, participantEmail: exists.email },
    c.req.header('CF-Connecting-IP')
  );

  return c.json({
    success: true,
    data: { message: 'Registration deleted successfully' }
  });
});

export default registrations;
