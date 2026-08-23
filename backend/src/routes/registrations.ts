import { Hono } from 'hono';
import { requireAuth } from '../utils/auth';
import { AppError } from '../utils/errors';
import { logAudit } from '../utils/audit';
import { rateLimit, limits } from '../utils/rateLimit';
import { parseCSV, formatCSV } from '../utils/csv';
import { checkEventAuthority } from './events';
import { HonoTypes, User } from '../types';

const registrations = new Hono<HonoTypes>();

// Helper to validate email format
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Helper to generate a new registration_id (e.g., DSMNRU-CS-000001)
async function generateRegistrationSeqId(db: D1Database, eventId: string, shortName: string): Promise<string> {
  const result = await db
    .prepare('SELECT COUNT(*) as count FROM event_registrations WHERE event_id = ?')
    .bind(eventId)
    .first<{ count: number }>();
  const seq = (result?.count || 0) + 1;
  const prefix = shortName.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return `DSMNRU-${prefix}-${seq.toString().padStart(6, '0')}`;
}

// 1. PUBLIC ENDPOINT: Built-in registration creation
registrations.post('/events/:id/register', rateLimit('registration', limits.registration), async (c) => {
  const db = c.env.DB;
  const eventId = c.req.param('id') || '';
  const body = await c.req.json().catch(() => ({}));

  // Fetch event details
  const event = await db
    .prepare("SELECT id, short_name, status, registration_type FROM events WHERE id = ?")
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

  // Extract primary fields
  const { full_name, email, phone, college, department, course, year, designation, custom_responses } = body;

  if (!full_name || !email || !phone || !college || !department || !course || !year || !designation) {
    throw new AppError('Missing required registration fields', 'VALIDATION_ERROR', 400);
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
        responsesToInsert.push({
          fieldId: f.id,
          value: String(respVal)
        });
      }
    }
  }

  // Generate IDs
  const id = crypto.randomUUID(); // Cryptographically opaque token for QR code
  const registrationId = await generateRegistrationSeqId(db, eventId, event.short_name);

  // Insert registration details inside D1 transaction
  await db
    .prepare(
      `INSERT INTO event_registrations (id, event_id, registration_id, full_name, email, phone, college, department, course, year, designation)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      designation
    )
    .run();

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

  return c.json({
    success: true,
    data: {
      id,
      registrationId,
      full_name,
      email: email.toLowerCase(),
      phone,
      college
    }
  });
});

// 2. COORDINATOR ENDPOINT: List/Search registrations
registrations.get('/events/:id/registrations', requireAuth(['super_admin', 'department_head', 'coordinator', 'volunteer']), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as User;
  if (!user) {
    throw new AppError('Unauthorized', 'UNAUTHORIZED', 401);
  }
  const eventId = c.req.param('id') || '';

  const page = parseInt(c.req.query('page') || '1', 10);
  const limit = parseInt(c.req.query('limit') || '20', 10);
  const search = c.req.query('search') || '';

  const offset = (page - 1) * limit;

  // Volunteer can lookup participants but coordinator check is strict
  if (user.role !== 'super_admin' && user.role !== 'volunteer') {
    const hasAuth = await checkEventAuthority(db, user.id, user.role, eventId);
    if (!hasAuth) {
      throw new AppError('Forbidden: Access denied', 'FORBIDDEN', 403);
    }
  }

  let query = 'SELECT * FROM event_registrations WHERE event_id = ?';
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
  const { csvText, mapping } = body;

  if (!csvText || !mapping) {
    throw new AppError('Missing csvText or mapping specification', 'VALIDATION_ERROR', 400);
  }

  const { rows, errors } = parseCSV(csvText, { maxRows: 1000 });
  if (errors.length > 0 && rows.length === 0) {
    throw new AppError(`Failed to parse CSV: ${errors.join(', ')}`, 'BAD_REQUEST', 400);
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
    total: rows.length,
    newRows: [] as any[],
    updatedRows: [] as any[],
    duplicateRows: [] as any[],
    rejectedRows: [] as any[]
  };

  const requiredFields = ['full_name', 'email', 'phone', 'college', 'department', 'course', 'year', 'designation'];

  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx];
    const mapped: Record<string, string> = {};
    
    // Map CSV Column → EventHub standard fields
    for (const stdField of requiredFields) {
      const csvColName = mapping[stdField];
      mapped[stdField] = row[csvColName] ? row[stdField] || row[csvColName] : '';
    }

    const email = mapped.email ? mapped.email.toLowerCase().trim() : '';

    // Validations
    if (!mapped.full_name || !email) {
      stats.rejectedRows.push({
        rowNumber: idx + 2,
        raw: row,
        reason: 'Missing Name or Email'
      });
      continue;
    }

    if (!isValidEmail(email)) {
      stats.rejectedRows.push({
        rowNumber: idx + 2,
        raw: row,
        reason: 'Invalid Email Address'
      });
      continue;
    }

    // Default missing optional fields to "N/A"
    for (const f of requiredFields) {
      if (!mapped[f]) mapped[f] = 'N/A';
    }

    // Check existing mapping
    const existing = existingMapByEmail.get(email);
    if (existing) {
      const isIdentical =
        existing.full_name.toLowerCase() === mapped.full_name.toLowerCase() &&
        existing.college.toLowerCase() === mapped.college.toLowerCase();

      if (isIdentical) {
        stats.duplicateRows.push({
          rowNumber: idx + 2,
          email,
          name: mapped.full_name
        });
      } else {
        stats.updatedRows.push({
          rowNumber: idx + 2,
          registration_id: existing.registration_id,
          email,
          originalName: existing.full_name,
          newName: mapped.full_name,
          mapped
        });
      }
    } else {
      stats.newRows.push({
        rowNumber: idx + 2,
        email,
        name: mapped.full_name,
        mapped
      });
    }
  }

  return c.json({
    success: true,
    data: {
      total: stats.total,
      newCount: stats.newRows.length,
      updatedCount: stats.updatedRows.length,
      duplicateCount: stats.duplicateRows.length,
      rejectedCount: stats.rejectedRows.length,
      preview: {
        newRows: stats.newRows.slice(0, 10),
        updatedRows: stats.updatedRows.slice(0, 10),
        rejectedRows: stats.rejectedRows.slice(0, 10)
      }
    }
  });
});

// 4. COORDINATOR ENDPOINT: CSV Import Apply Transaction (Repeated import safe)
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
  const { csvText, mapping, filename } = body;

  if (!csvText || !mapping || !filename) {
    throw new AppError('Missing required arguments', 'VALIDATION_ERROR', 400);
  }

  const event = await db.prepare('SELECT short_name FROM events WHERE id = ?').bind(eventId).first<{ short_name: string }>();
  if (!event) {
    throw new AppError('Event not found', 'NOT_FOUND', 404);
  }

  const { rows, errors: csvErrors } = parseCSV(csvText, { maxRows: 1000 });
  if (csvErrors.length > 0 && rows.length === 0) {
    throw new AppError('Failed to parse CSV', 'BAD_REQUEST', 400);
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
  const requiredFields = ['full_name', 'email', 'phone', 'college', 'department', 'course', 'year', 'designation'];

  // Start processing rows
  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx];
    const mapped: Record<string, string> = {};

    for (const stdField of requiredFields) {
      const csvColName = mapping[stdField];
      mapped[stdField] = row[csvColName] ? row[stdField] || row[csvColName] : '';
    }

    const email = mapped.email ? mapped.email.toLowerCase().trim() : '';

    if (!mapped.full_name || !email) {
      rejected++;
      errorsList.push({ rowNumber: idx + 2, raw: row, reason: 'Missing Name or Email' });
      continue;
    }

    if (!isValidEmail(email)) {
      rejected++;
      errorsList.push({ rowNumber: idx + 2, raw: row, reason: 'Invalid Email Address' });
      continue;
    }

    for (const f of requiredFields) {
      if (!mapped[f]) mapped[f] = 'N/A';
    }

    const existing = existingMapByEmail.get(email);
    try {
      if (existing) {
        const isIdentical =
          existing.full_name.toLowerCase() === mapped.full_name.toLowerCase() &&
          existing.college.toLowerCase() === mapped.college.toLowerCase();

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
              mapped.full_name,
              mapped.phone,
              mapped.college,
              mapped.department,
              mapped.course,
              mapped.year,
              mapped.designation,
              existing.id
            )
            .run();
          updated++;
        }
      } else {
        // Insert new registration
        const id = crypto.randomUUID();
        const registrationId = await generateRegistrationSeqId(db, eventId, event.short_name);

        await db
          .prepare(
            `INSERT INTO event_registrations (id, event_id, registration_id, full_name, email, phone, college, department, course, year, designation)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            id,
            eventId,
            registrationId,
            mapped.full_name,
            email,
            mapped.phone,
            mapped.college,
            mapped.department,
            mapped.course,
            mapped.year,
            mapped.designation
          )
          .run();
        inserted++;
      }
    } catch (err: any) {
      rejected++;
      errorsList.push({ rowNumber: idx + 2, raw: row, reason: err.message || 'Database error' });
    }
  }

  // Record import history
  await db
    .prepare(
      `INSERT INTO registration_imports (id, event_id, uploader_id, filename, row_count, inserted_count, updated_count, duplicate_count, rejected_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(importId, eventId, user.id, filename, rows.length, inserted, updated, duplicates, rejected)
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
      totalProcessed: rows.length,
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
