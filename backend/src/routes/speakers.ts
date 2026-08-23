import { Hono } from 'hono';
import { requireAuth } from '../utils/auth';
import { AppError } from '../utils/errors';
import { logAudit } from '../utils/audit';
import { checkEventAuthority } from './events';
import { HonoTypes, User } from '../types';

const speakers = new Hono<HonoTypes>();

// GET /events/:id/speakers - Public view of speakers
speakers.get('/events/:id/speakers', async (c) => {
  const db = c.env.DB;
  const eventId = c.req.param('id');

  const list = await db
    .prepare(
      `SELECT s.* FROM speakers s
       JOIN event_speakers es ON s.id = es.speaker_id
       WHERE es.event_id = ?`
    )
    .bind(eventId)
    .all<any>();

  return c.json({
    success: true,
    data: list.results || []
  });
});

// POST /events/:id/speakers - Add speaker to event (Coordinators only)
speakers.post('/events/:id/speakers', requireAuth(['super_admin', 'department_head', 'coordinator']), async (c) => {
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
  const { name, designation, institution, photo_url, biography } = body;

  if (!name || !designation || !institution) {
    throw new AppError('Missing required speaker details', 'VALIDATION_ERROR', 400);
  }

  const speakerId = crypto.randomUUID();

  // Insert master speaker
  await db
    .prepare(
      `INSERT INTO speakers (id, name, designation, institution, photo_url, biography)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(speakerId, name, designation, institution, photo_url || null, biography || null)
    .run();

  // Link to event
  await db
    .prepare('INSERT INTO event_speakers (event_id, speaker_id) VALUES (?, ?)')
    .bind(eventId, speakerId)
    .run();

  await logAudit(
    db,
    user.id,
    user.email,
    'ADD_SPEAKER',
    'speaker',
    speakerId,
    { eventId, name },
    c.req.header('CF-Connecting-IP')
  );

  return c.json({
    success: true,
    data: { id: speakerId, name, designation, institution, photo_url, biography }
  });
});

export default speakers;
