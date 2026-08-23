import { Env } from '../types';
import { sendEmail } from './email';

/**
 * Processes pending items in the email queue asynchronously.
 * Designed to be executed with ctx.waitUntil(...) inside Workers.
 */
export async function processEmailQueue(env: Env): Promise<void> {
  const db = env.DB;

  try {
    // 1. Fetch pending emails that are due for delivery
    const pendingJobs = await db
      .prepare(
        `SELECT q.*, c.subject, c.body_html
         FROM email_queue q
         JOIN email_campaigns c ON q.campaign_id = c.id
         WHERE q.status = 'PENDING' AND (q.next_retry IS NULL OR q.next_retry <= datetime('now'))
         LIMIT 20` // Process in small batches of 20 to avoid exceeding Worker memory/timeout
      )
      .all<any>();

    const jobs = pendingJobs.results || [];
    if (jobs.length === 0) return;

    for (const job of jobs) {
      // Parse custom variables (e.g. participant name, certificate code)
      let variables: Record<string, string> = {};
      try {
        variables = JSON.parse(job.variables_json);
      } catch {
        // ignore
      }

      // Compile body HTML with dynamic fields replacement
      let finalHtml = job.body_html;
      for (const [key, val] of Object.entries(variables)) {
        finalHtml = finalHtml.replaceAll(`{{${key}}}`, val);
      }
      finalHtml = finalHtml.replaceAll('{{recipient_name}}', job.recipient_name);

      // Perform sending
      const result = await sendEmail(env, job.recipient_email, job.subject, finalHtml);

      const logId = crypto.randomUUID();
      if (result.success) {
        // Mark as sent
        await db
          .prepare("UPDATE email_queue SET status = 'SENT', attempt_count = attempt_count + 1 WHERE id = ?")
          .bind(job.id)
          .run();

        // Write to audit trail
        await db
          .prepare(
            `INSERT INTO email_logs (id, queue_id, event_id, recipient, subject, status, provider_message_id)
             VALUES (?, ?, ?, ?, ?, 'SENT', ?)`
          )
          .bind(logId, job.id, job.event_id, job.recipient_email, job.subject, result.messageId || null)
          .run();
      } else {
        const nextAttempt = job.attempt_count + 1;
        const failedStatus = nextAttempt >= 3 ? 'FAILED' : 'PENDING';
        
        // Calculate exponential backoff retry time
        const backoffMinutes = Math.pow(2, nextAttempt) * 5; // 10m, 20m, etc.
        const nextRetryTime = new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString();

        await db
          .prepare(
            `UPDATE email_queue
             SET status = ?, attempt_count = ?, last_error = ?, next_retry = ?
             WHERE id = ?`
          )
          .bind(failedStatus, nextAttempt, result.error || 'Unknown Error', failedStatus === 'PENDING' ? nextRetryTime : null, job.id)
          .run();

        await db
          .prepare(
            `INSERT INTO email_logs (id, queue_id, event_id, recipient, subject, status, error)
             VALUES (?, ?, ?, ?, ?, 'FAILED', ?)`
          )
          .bind(logId, job.id, job.event_id, job.recipient_email, job.subject, result.error || 'Failed')
          .run();
      }
    }

    // Recursively check if there's more pending jobs (safely chained)
    // To prevent infinite execution loop, the caller will handle schedules or simple triggers.
  } catch (err) {
    console.error('Email queue processing failed:', err);
  }
}
