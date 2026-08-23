import { Hono } from 'hono';
import { requireAuth } from '../utils/auth';
import { AppError } from '../utils/errors';
import { logAudit } from '../utils/audit';
import { HonoTypes, User } from '../types';
import {
  authorizeCreateEvent,
  authorizeEventAction,
  checkEventAuthority,
  getUserDepartmentId
} from '../utils/authorize';

const events = new Hono<HonoTypes>();

// GET / - List events (Public with filter, or Authenticated for coordinators/etc.)
events.get('/', async (c) => {
  const db = c.env.DB;
  const user = c.get('user');

  const page = parseInt(c.req.query('page') || '1', 10);
  const limit = parseInt(c.req.query('limit') || '12', 10);
  const search = c.req.query('search') || '';
  const departmentId = c.req.query('department_id') || '';
  const type = c.req.query('type') || '';
  const statusFilter = c.req.query('status') || '';

  const offset = (page - 1) * limit;

  let query = `
    SELECT e.*, d.name as department_name, d.code as department_code
    FROM events e
    LEFT JOIN departments d ON e.department_id = d.id
    WHERE 1=1
  `;
  let countQuery = 'SELECT COUNT(*) as count FROM events WHERE 1=1';
  const params: any[] = [];
  const countParams: any[] = [];

  // Filter public events if unauthorized/standard participant
  if (!user) {
    query += " AND e.status != 'DRAFT'";
    countQuery += " AND e.status != 'DRAFT'";
  } else if (user.role === 'volunteer') {
    query += " AND e.id IN (SELECT event_id FROM event_members WHERE user_id = ? AND role = 'volunteer')";
    countQuery += " AND id IN (SELECT event_id FROM event_members WHERE user_id = ? AND role = 'volunteer')";
    params.push(user.id);
    countParams.push(user.id);
  } else if (user.role === 'department_head') {
    const deptId = (await getUserDepartmentId(db, user.id)) || '';
    query += " AND (e.status != 'DRAFT' OR e.department_id = ?)";
    countQuery += " AND (e.status != 'DRAFT' OR e.department_id = ?)";
    params.push(deptId);
    countParams.push(deptId);
  } else if (user.role === 'coordinator') {
    const deptId = (await getUserDepartmentId(db, user.id)) || '';
    query += " AND (e.status != 'DRAFT' OR e.department_id = ? OR e.id IN (SELECT event_id FROM event_members WHERE user_id = ?))";
    countQuery += " AND (e.status != 'DRAFT' OR e.department_id = ? OR e.id IN (SELECT event_id FROM event_members WHERE user_id = ?))";
    params.push(deptId, user.id);
    countParams.push(deptId, user.id);
  }

  if (search) {
    const pattern = `%${search}%`;
    query += ' AND (e.name LIKE ? OR e.short_name LIKE ? OR e.description LIKE ?)';
    countQuery += ' AND (e.name LIKE ? OR e.short_name LIKE ? OR e.description LIKE ?)';
    params.push(pattern, pattern, pattern);
    countParams.push(pattern, pattern, pattern);
  }

  if (departmentId) {
    query += ' AND e.department_id = ?';
    countQuery += ' AND e.department_id = ?';
    params.push(departmentId);
    countParams.push(departmentId);
  }

  if (type) {
    query += ' AND e.event_type = ?';
    countQuery += ' AND e.event_type = ?';
    params.push(type);
    countParams.push(type);
  }

  if (statusFilter) {
    query += ' AND e.status = ?';
    countQuery += ' AND e.status = ?';
    params.push(statusFilter);
    countParams.push(statusFilter);
  }

  query += ' ORDER BY e.start_date DESC, e.start_time DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const [list, countResult] = await Promise.all([
    db.prepare(query).bind(...params).all<any>(),
    db.prepare(countQuery).bind(...countParams).first<{ count: number }>()
  ]);

  const total = countResult ? countResult.count : 0;

  return c.json({
    success: true,
    data: {
      events: list.results || [],
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    }
  });
});

// GET /:slug_or_id - Public & private checks
events.get('/:slug_or_id', async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const param = c.req.param('slug_or_id');

  const event = await db
    .prepare(
      `SELECT e.*, d.name as department_name, d.code as department_code
       FROM events e
       LEFT JOIN departments d ON e.department_id = d.id
       WHERE e.id = ? OR e.slug = ?`
    )
    .bind(param, param)
    .first<any>();

  if (!event) {
    throw new AppError('Event not found', 'NOT_FOUND', 404);
  }

  // If in DRAFT, check role/authority
  if (event.status === 'DRAFT') {
    if (!user) {
      throw new AppError('Unauthorized to view this draft event', 'UNAUTHORIZED', 401);
    }
    const hasAuth = await checkEventAuthority(db, user.id, user.role, event.id);
    if (!hasAuth) {
      throw new AppError('Forbidden: Access to draft event denied', 'FORBIDDEN', 403);
    }
  }

  return c.json({
    success: true,
    data: event
  });
});

// POST / - Create Event (Super Admin / Dept Head / Coordinator of own department)
events.post('/', requireAuth(['super_admin', 'department_head', 'coordinator']), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as User;
  if (!user) {
    throw new AppError('Unauthorized', 'UNAUTHORIZED', 401);
  }
  const body = await c.req.json().catch(() => ({}));

  const {
    name,
    short_name,
    event_type,
    theme,
    description,
    banner_url,
    start_date,
    end_date,
    start_time,
    end_time,
    venue,
    format,
    meeting_link,
    registration_type,
    external_form_url
  } = body;

  if (!name || !short_name || !event_type || !start_date || !end_date || !start_time || !end_time || !venue || !format || !registration_type) {
    throw new AppError('Missing required basic fields', 'VALIDATION_ERROR', 400);
  }

  const derivedDepartment = await authorizeCreateEvent(db, user);
  let departmentId = derivedDepartment;
  if (user.role === 'super_admin') {
    if (!body.department_id) {
      throw new AppError('Missing department_id', 'VALIDATION_ERROR', 400);
    }
    departmentId = body.department_id;
  } else if (body.department_id && body.department_id !== departmentId) {
    throw new AppError('Forbidden: Event department is derived from your assignment', 'FORBIDDEN', 403);
  }
  if (!departmentId) {
    throw new AppError('Missing department_id', 'VALIDATION_ERROR', 400);
  }

  // Validate format and links
  if (format === 'online' && !meeting_link) {
    throw new AppError('Online events require a meeting link', 'VALIDATION_ERROR', 400);
  }
  if (registration_type === 'external' && !external_form_url) {
    throw new AppError('External registration requires form URL', 'VALIDATION_ERROR', 400);
  }

  const id = crypto.randomUUID();
  // Generate unique slug
  let slug = short_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const existingSlug = await db.prepare('SELECT id FROM events WHERE slug = ?').bind(slug).first();
  if (existingSlug) {
    slug = `${slug}-${Math.floor(1000 + Math.random() * 9000)}`;
  }

  await db
    .prepare(
      `INSERT INTO events (id, slug, name, short_name, event_type, department_id, theme, description, banner_url,
                           start_date, end_date, start_time, end_time, venue, format, meeting_link, registration_type, external_form_url, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT')`
    )
    .bind(
      id,
      slug,
      name,
      short_name,
      event_type,
      departmentId,
      theme || null,
      description || null,
      banner_url || null,
      start_date,
      end_date,
      start_time,
      end_time,
      venue,
      format,
      meeting_link || null,
      registration_type,
      external_form_url || null
    )
    .run();

  // If created by department head or super admin, make them a coordinator of the event
  await db
    .prepare('INSERT INTO event_members (event_id, user_id, role) VALUES (?, ?, ?)')
    .bind(id, user.id, 'coordinator')
    .run();

  await logAudit(
    db,
    user.id,
    user.email,
    'CREATE_EVENT',
    'event',
    id,
    { name, slug, departmentId },
    c.req.header('CF-Connecting-IP')
  );

  return c.json({
    success: true,
    data: { id, slug, name }
  });
});

// PUT /:id - Update event (Super Admin, Coord, or Department Head)
events.put('/:id', requireAuth(['super_admin', 'department_head', 'coordinator']), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as User;
  if (!user) {
    throw new AppError('Unauthorized', 'UNAUTHORIZED', 401);
  }
  const eventId = c.req.param('id') || '';
  const body = await c.req.json().catch(() => ({}));

  await authorizeEventAction(db, user, eventId, 'manage_event');

  const {
    name,
    short_name,
    event_type,
    theme,
    description,
    banner_url,
    start_date,
    end_date,
    start_time,
    end_time,
    venue,
    format,
    meeting_link,
    registration_type,
    external_form_url,
    google_drive_folder_url
  } = body;

  if (!name || !short_name || !event_type || !start_date || !end_date || !start_time || !end_time || !venue || !format || !registration_type) {
    throw new AppError('Missing required fields', 'VALIDATION_ERROR', 400);
  }

  // Validate formats
  if (format === 'online' && !meeting_link) {
    throw new AppError('Online events require a meeting link', 'VALIDATION_ERROR', 400);
  }
  if (registration_type === 'external' && !external_form_url) {
    throw new AppError('External registration requires form URL', 'VALIDATION_ERROR', 400);
  }

  // Update
  await db
    .prepare(
      `UPDATE events
       SET name = ?, short_name = ?, event_type = ?, theme = ?, description = ?, banner_url = ?, start_date = ?,
           end_date = ?, start_time = ?, end_time = ?, venue = ?, format = ?, meeting_link = ?, registration_type = ?,
           external_form_url = ?, google_drive_folder_url = ?, updated_at = datetime('now')
       WHERE id = ?`
    )
    .bind(
      name,
      short_name,
      event_type,
      theme || null,
      description || null,
      banner_url || null,
      start_date,
      end_date,
      start_time,
      end_time,
      venue,
      format,
      meeting_link || null,
      registration_type,
      external_form_url || null,
      google_drive_folder_url || null,
      eventId
    )
    .run();

  await logAudit(
    db,
    user.id,
    user.email,
    'UPDATE_EVENT',
    'event',
    eventId,
    { name },
    c.req.header('CF-Connecting-IP')
  );

  return c.json({
    success: true,
    data: { id: eventId, name }
  });
});

// PUT /:id/status - Event Lifecycle State Transitions (Server-Side Validated)
events.put('/:id/status', requireAuth(['super_admin', 'department_head', 'coordinator']), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as User;
  if (!user) {
    throw new AppError('Unauthorized', 'UNAUTHORIZED', 401);
  }
  const eventId = c.req.param('id') || '';
  const body = await c.req.json().catch(() => ({}));
  const { status } = body;

  if (!status) {
    throw new AppError('Missing status in payload', 'VALIDATION_ERROR', 400);
  }

  await authorizeEventAction(db, user, eventId, 'manage_event');

  const event = await db.prepare('SELECT status, name FROM events WHERE id = ?').bind(eventId).first<any>();
  if (!event) {
    throw new AppError('Event not found', 'NOT_FOUND', 404);
  }

  const currentStatus = event.status;

  // Validate state transition
  const validTransitions: Record<string, string[]> = {
    'DRAFT': ['PUBLISHED'],
    'PUBLISHED': ['DRAFT', 'REGISTRATION_OPEN'],
    'REGISTRATION_OPEN': ['REGISTRATION_CLOSED'],
    'REGISTRATION_CLOSED': ['ONGOING'],
    'ONGOING': ['COMPLETED'],
    'COMPLETED': ['ARCHIVED'],
    'ARCHIVED': []
  };

  const allowed = validTransitions[currentStatus] || [];
  // Super Admin can force archive anything except if already archived
  if (status === 'ARCHIVED' && user.role === 'super_admin' && currentStatus !== 'ARCHIVED') {
    // permitted
  } else if (!allowed.includes(status)) {
    throw new AppError(
      `Invalid lifecycle transition from ${currentStatus} to ${status}.`,
      'INVALID_STATE_TRANSITION',
      400
    );
  }

  await db
    .prepare("UPDATE events SET status = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(status, eventId)
    .run();

  await logAudit(
    db,
    user.id,
    user.email,
    'TRANSITION_EVENT_STATUS',
    'event',
    eventId,
    { from: currentStatus, to: status, eventName: event.name },
    c.req.header('CF-Connecting-IP')
  );

  return c.json({
    success: true,
    data: { id: eventId, status }
  });
});

// POST /:id/duplicate - Duplicate Event (Structure Copy)
events.post('/:id/duplicate', requireAuth(['super_admin', 'department_head', 'coordinator']), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as User;
  if (!user) {
    throw new AppError('Unauthorized', 'UNAUTHORIZED', 401);
  }
  const eventId = c.req.param('id') || '';

  await authorizeEventAction(db, user, eventId, 'manage_event');

  const original = await db.prepare('SELECT * FROM events WHERE id = ?').bind(eventId).first<any>();
  if (!original) {
    throw new AppError('Original event not found', 'NOT_FOUND', 404);
  }

  const newId = crypto.randomUUID();
  let newSlug = `${original.slug}-copy`;
  const existingSlug = await db.prepare('SELECT id FROM events WHERE slug = ?').bind(newSlug).first();
  if (existingSlug) {
    newSlug = `${newSlug}-${Math.floor(1000 + Math.random() * 9000)}`;
  }

  // 1. Copy event row, set DRAFT and reset Drive URL
  await db
    .prepare(
      `INSERT INTO events (id, slug, name, short_name, event_type, department_id, theme, description, banner_url,
                           start_date, end_date, start_time, end_time, venue, format, meeting_link, registration_type, external_form_url, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT')`
    )
    .bind(
      newId,
      newSlug,
      `${original.name} (Copy)`,
      original.short_name,
      original.event_type,
      original.department_id,
      original.theme,
      original.description,
      original.banner_url,
      original.start_date,
      original.end_date,
      original.start_time,
      original.end_time,
      original.venue,
      original.format,
      original.meeting_link,
      original.registration_type,
      original.external_form_url
    )
    .run();

  // 2. Assign current user as coordinator
  await db
    .prepare('INSERT INTO event_members (event_id, user_id, role) VALUES (?, ?, ?)')
    .bind(newId, user.id, 'coordinator')
    .run();

  // 3. Copy registration fields
  const fields = await db.prepare('SELECT * FROM registration_fields WHERE event_id = ?').bind(eventId).all<any>();
  if (fields.results && fields.results.length > 0) {
    for (const f of fields.results) {
      await db
        .prepare(
          `INSERT INTO registration_fields (id, event_id, label, description, field_type, required, options, field_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(crypto.randomUUID(), newId, f.label, f.description, f.field_type, f.required, f.options, f.field_order)
        .run();
    }
  }

  // 4. Copy schedule items
  const schedule = await db.prepare('SELECT * FROM schedule_items WHERE event_id = ?').bind(eventId).all<any>();
  if (schedule.results && schedule.results.length > 0) {
    for (const s of schedule.results) {
      await db
        .prepare(
          `INSERT INTO schedule_items (id, event_id, start_time, end_time, title, description, speaker_name, location)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(crypto.randomUUID(), newId, s.start_time, s.end_time, s.title, s.description, s.speaker_name, s.location)
        .run();
    }
  }

  // 5. Copy event speakers
  const speakers = await db.prepare('SELECT speaker_id FROM event_speakers WHERE event_id = ?').bind(eventId).all<any>();
  if (speakers.results && speakers.results.length > 0) {
    for (const sp of speakers.results) {
      await db
        .prepare('INSERT INTO event_speakers (event_id, speaker_id) VALUES (?, ?)')
        .bind(newId, sp.speaker_id)
        .run();
    }
  }

  // 6. Copy certificate templates
  const certs = await db.prepare('SELECT * FROM event_certificate_templates WHERE event_id = ?').bind(eventId).all<any>();
  if (certs.results && certs.results.length > 0) {
    for (const cTemplate of certs.results) {
      await db
        .prepare(
          `INSERT INTO event_certificate_templates (id, event_id, name, bg_image_url, layout_json, certificate_type)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(crypto.randomUUID(), newId, cTemplate.name, cTemplate.bg_image_url, cTemplate.layout_json, cTemplate.certificate_type)
        .run();
    }
  }

  await logAudit(
    db,
    user.id,
    user.email,
    'DUPLICATE_EVENT',
    'event',
    newId,
    { originalEventId: eventId },
    c.req.header('CF-Connecting-IP')
  );

  return c.json({
    success: true,
    data: { id: newId, slug: newSlug, name: `${original.name} (Copy)` }
  });
});

export default events;
export { checkEventAuthority };
