import { Hono } from 'hono';
import { requireAuth } from '../utils/auth';
import { AppError } from '../utils/errors';
import { logAudit } from '../utils/audit';
import { rateLimit, limits } from '../utils/rateLimit';
import { processEmailQueue } from '../utils/emailQueue';
import { checkEventAuthority } from './events';
import { HonoTypes, User } from '../types';

const emails = new Hono<HonoTypes>();

// Apply authorization to all routes in this router
emails.use('*', requireAuth(['super_admin', 'department_head', 'coordinator']));

// 1. POST: Create and Queue Email Campaign (Safe, idempotent, triggers async background queue processor)
emails.post('/events/:id/campaign', rateLimit('email', limits.email), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as User;
  if (!user) {
    throw new AppError('Unauthorized', 'UNAUTHORIZED', 401);
  }
  const eventId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const { title, subject, body_html, recipient_filter = 'all' } = body;

  const hasAuth = await checkEventAuthority(db, user.id, user.role, eventId);
  if (!hasAuth) {
    throw new AppError('Forbidden: Access denied', 'FORBIDDEN', 403);
  }

  if (!title || !subject || !body_html) {
    throw new AppError('Missing required email campaign details: title, subject, body_html', 'VALIDATION_ERROR', 400);
  }

  // Idempotency: Prevent identical campaign creation within short span (e.g. rapid multiple clicks)
  const existingCampaign = await db
    .prepare("SELECT id FROM email_campaigns WHERE event_id = ? AND title = ? AND created_at >= datetime('now', '-2 minutes')")
    .bind(eventId, title)
    .first();

  if (existingCampaign) {
    throw new AppError('An identical campaign was created very recently. Please wait a bit.', 'DUPLICATE_CAMPAIGN', 409);
  }

  const campaignId = crypto.randomUUID();

  // Load target recipients based on filter
  let query = 'SELECT id, full_name, email FROM event_registrations WHERE event_id = ?';
  const params: any[] = [eventId];

  if (recipient_filter === 'attendees') {
    query = `
      SELECT r.id, r.full_name, r.email
      FROM event_registrations r
      JOIN attendance a ON r.id = a.registration_id
      WHERE r.event_id = ? AND a.attendance_type = 'event_entry'
    `;
  }

  const recipients = await db.prepare(query).bind(...params).all<any>();
  const list = recipients.results || [];

  if (list.length === 0) {
    throw new AppError('No eligible recipients found matching the selected filter.', 'NO_RECIPIENTS', 400);
  }

  // Insert Campaign in D1
  await db
    .prepare(
      `INSERT INTO email_campaigns (id, event_id, sender_id, title, subject, body_html, recipient_filter, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'QUEUED')`
    )
    .bind(campaignId, eventId, user.id, title, subject, body_html, recipient_filter)
    .run();

  // Batch insert individual jobs to Queue
  for (const recipient of list) {
    const queueId = crypto.randomUUID();
    const variables = {
      recipient_name: recipient.full_name,
      email: recipient.email,
      event_id: eventId
    };

    await db
      .prepare(
        `INSERT INTO email_queue (id, campaign_id, event_id, recipient_email, recipient_name, variables_json, status)
         VALUES (?, ?, ?, ?, ?, ?, 'PENDING')`
      )
      .bind(queueId, campaignId, eventId, recipient.email, recipient.full_name, JSON.stringify(variables))
      .run();
  }

  await logAudit(
    db,
    user.id,
    user.email,
    'QUEUE_EMAIL_CAMPAIGN',
    'email_campaign',
    campaignId,
    { eventId, title, recipient_count: list.length, filter: recipient_filter },
    c.req.header('CF-Connecting-IP')
  );

  // Trigger Asynchronous Queue processor!
  const ctx = c.executionCtx;
  if (ctx && ctx.waitUntil) {
    ctx.waitUntil(processEmailQueue(c.env));
  } else {
    // Local dev fallback if waitUntil is not exposed
    processEmailQueue(c.env);
  }

  return c.json({
    success: true,
    data: {
      campaignId,
      title,
      subject,
      recipientCount: list.length,
      status: 'QUEUED'
    }
  });
});

// 2. GET: List all campaigns
emails.get('/events/:id/campaigns', async (c) => {
  const db = c.env.DB;
  const eventId = c.req.param('id');

  const list = await db
    .prepare(
      `SELECT c.*, u.full_name as sender_name,
              (SELECT COUNT(*) FROM email_queue WHERE campaign_id = c.id) as total_jobs,
              (SELECT COUNT(*) FROM email_queue WHERE campaign_id = c.id AND status = 'SENT') as sent_jobs
       FROM email_campaigns c
       LEFT JOIN users u ON c.sender_id = u.id
       WHERE c.event_id = ?
       ORDER BY c.created_at DESC`
    )
    .bind(eventId)
    .all<any>();

  return c.json({
    success: true,
    data: list.results || []
  });
});

// 3. GET: List email delivery status logs (paginated)
emails.get('/events/:id/logs', async (c) => {
  const db = c.env.DB;
  const eventId = c.req.param('id');
  const page = parseInt(c.req.query('page') || '1', 10);
  const limit = parseInt(c.req.query('limit') || '50', 10);

  const offset = (page - 1) * limit;

  const countRes = await db
    .prepare('SELECT COUNT(*) as count FROM email_logs WHERE event_id = ?')
    .bind(eventId)
    .first<{ count: number }>();
  const total = countRes?.count || 0;

  const list = await db
    .prepare(
      `SELECT * FROM email_logs
       WHERE event_id = ?
       ORDER BY timestamp DESC
       LIMIT ? OFFSET ?`
    )
    .bind(eventId, limit, offset)
    .all<any>();

  return c.json({
    success: true,
    data: {
      logs: list.results || [],
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    }
  });
});

export default emails;
