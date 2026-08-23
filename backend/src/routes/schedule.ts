import { Hono } from 'hono';
import { requireAuth } from '../utils/auth';
import { AppError } from '../utils/errors';
import { logAudit } from '../utils/audit';
import { checkEventAuthority } from './events';
import { HonoTypes, User } from '../types';

const schedule = new Hono<HonoTypes>();

// GET /events/:id/schedule - Public schedule list
schedule.get('/events/:id/schedule', async (c) => {
  const db = c.env.DB;
  const eventId = c.req.param('id');

  const list = await db
    .prepare('SELECT * FROM schedule_items WHERE event_id = ? ORDER BY start_time ASC')
    .bind(eventId)
    .all<any>();

  return c.json({
    success: true,
    data: list.results || []
  });
});

// POST /events/:id/schedule - Add schedule item (Coordinator/Dept head only)
schedule.post('/events/:id/schedule', requireAuth(['super_admin', 'department_head', 'coordinator']), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as User;
  if (!user) {
    throw new AppError('Unauthorized', 'UNAUTHORIZED', 401);
  }
  const eventId = c.req.param('id');

  const hasAuth = await checkEventAuthority(db, user.id, user.role, eventId);
  if (!hasAuth) {
    throw new AppError('Forbidden: Access denied', 'FORBIDDEN', 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const { start_time, end_time, title, description, speaker_name, location } = body;

  if (!start_time || !end_time || !title) {
    throw new AppError('Missing required schedule fields', 'VALIDATION_ERROR', 400);
  }

  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO schedule_items (id, event_id, start_time, end_time, title, description, speaker_name, location)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, eventId, start_time, end_time, title, description || null, speaker_name || null, location || null)
    .run();

  await logAudit(
    db,
    user.id,
    user.email,
    'ADD_SCHEDULE_ITEM',
    'schedule_item',
    id,
    { eventId, title },
    c.req.header('CF-Connecting-IP')
  );

  return c.json({
    success: true,
    data: { id, start_time, end_time, title, description, speaker_name, location }
  });
});

export default schedule;
