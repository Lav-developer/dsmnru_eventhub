import { Hono } from 'hono';
import { requireAuth } from '../utils/auth';
import { AppError } from '../utils/errors';
import { logAudit } from '../utils/audit';
import { checkEventAuthority } from './events';
import { HonoTypes, User } from '../types';

const announcements = new Hono<HonoTypes>();

// GET /events/:id/announcements - Public view
announcements.get('/events/:id/announcements', async (c) => {
  const db = c.env.DB;
  const eventId = c.req.param('id');

  const list = await db
    .prepare('SELECT * FROM announcements WHERE event_id = ? ORDER BY published_at DESC')
    .bind(eventId)
    .all<any>();

  return c.json({
    success: true,
    data: list.results || []
  });
});

// POST /events/:id/announcements - Add announcement
announcements.post('/events/:id/announcements', requireAuth(['super_admin', 'department_head', 'coordinator']), async (c) => {
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
  const { title, content, priority, sendEmail } = body;

  if (!title || !content) {
    throw new AppError('Missing title or content', 'VALIDATION_ERROR', 400);
  }

  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO announcements (id, event_id, title, content, priority)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(id, eventId, title, content, priority || 'normal')
    .run();

  await logAudit(
    db,
    user.id,
    user.email,
    'CREATE_ANNOUNCEMENT',
    'announcement',
    id,
    { eventId, title, sendEmail },
    c.req.header('CF-Connecting-IP')
  );

  // If sendEmail is true, we will queue the emails inside a separate email campaign.
  if (sendEmail) {
    try {
      const campaignId = crypto.randomUUID();
      const subject = `New Announcement: ${title}`;
      const bodyHtml = `
        <h3>Dear Participant,</h3>
        <p>A new announcement has been posted for your registered event.</p>
        <hr />
        <h4>${title}</h4>
        <div style="white-space: pre-wrap;">${content}</div>
        <hr />
        <p>Best regards,<br/>DSMNRU EventHub Team</p>
      `;

      // Create campaign
      await db
        .prepare(
          `INSERT INTO email_campaigns (id, event_id, sender_id, title, subject, body_html, recipient_filter, status)
           VALUES (?, ?, ?, ?, ?, ?, 'all', 'QUEUED')`
        )
        .bind(campaignId, eventId, user.id, `Announcement: ${title}`, subject, bodyHtml)
        .run();

      // Fetch all participants
      const participants = await db
        .prepare('SELECT id, full_name, email FROM event_registrations WHERE event_id = ?')
        .bind(eventId)
        .all<any>();

      if (participants.results && participants.results.length > 0) {
        for (const p of participants.results) {
          const queueId = crypto.randomUUID();
          await db
            .prepare(
              `INSERT INTO email_queue (id, campaign_id, event_id, recipient_email, recipient_name, variables_json, status)
               VALUES (?, ?, ?, ?, ?, ?, 'PENDING')`
            )
            .bind(
              queueId,
              campaignId,
              eventId,
              p.email,
              p.full_name,
              JSON.stringify({ recipient_name: p.full_name, title })
            )
            .run();
        }
      }
    } catch (emailErr) {
      console.error('Failed to queue announcement emails:', emailErr);
    }
  }

  return c.json({
    success: true,
    data: { id, title, content, priority }
  });
});

export default announcements;
