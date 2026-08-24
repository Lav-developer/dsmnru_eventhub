import { Env } from '../types';
import { sendEmail } from './email';

export interface RegistrationConfirmation {
  eventId: string;
  eventName: string;
  registrationId: string;
  fullName: string;
  email: string;
  /** Opaque pass token. Used only to build the secure retrieval link. */
  qrToken: string;
  startDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  venue?: string | null;
  format?: string | null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Build the confirmation email body.
 *
 * The QR image is deliberately NOT embedded and the raw pass token is NOT
 * printed in the body. Mailboxes get forwarded and quoted, and an inline pass
 * is a bearer credential — anyone holding it could be scanned in. Instead the
 * participant gets a link back to their own confirmation page, where the pass
 * is rendered and can be downloaded. No other personal data (phone, college,
 * custom answers) is included.
 */
export function buildRegistrationEmail(
  data: RegistrationConfirmation,
  baseUrl: string
): { subject: string; html: string } {
  const subject = `Registration confirmed — ${data.eventName} (${data.registrationId})`;

  const passUrl = `${baseUrl.replace(/\/+$/, '')}/pass/${encodeURIComponent(data.qrToken)}`;

  const when = [data.startDate, [data.startTime, data.endTime].filter(Boolean).join(' – ')]
    .filter(Boolean)
    .join(' at ');

  const detailRows = [
    ['Event', data.eventName],
    ['Registration ID', data.registrationId],
    when ? ['When', when] : null,
    data.venue ? ['Venue', data.venue] : null,
    data.format ? ['Format', data.format] : null
  ].filter(Boolean) as string[][];

  const rowsHtml = detailRows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#64748b;font-size:13px;">${escapeHtml(
          label
        )}</td><td style="padding:6px 0;color:#0f172a;font-size:13px;font-weight:600;">${escapeHtml(
          value
        )}</td></tr>`
    )
    .join('');

  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;color:#0f172a;">
  <h2 style="margin:0 0 4px;">You're registered 🎉</h2>
  <p style="margin:0 0 16px;color:#475569;font-size:14px;">
    Hi ${escapeHtml(data.fullName)}, your place at <strong>${escapeHtml(
      data.eventName
    )}</strong> is confirmed.
  </p>

  <table style="border-collapse:collapse;margin-bottom:20px;">${rowsHtml}</table>

  <p style="margin:0 0 8px;font-size:14px;"><strong>Your entry pass</strong></p>
  <p style="margin:0 0 12px;color:#475569;font-size:13px;">
    Open the secure link below to view, download or print the QR code you'll need at the entrance:
  </p>
  <p style="margin:0 0 20px;">
    <a href="${passUrl}" style="background:#2563eb;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600;display:inline-block;">View my entry pass</a>
  </p>

  <p style="margin:0 0 6px;font-size:14px;"><strong>Please remember</strong></p>
  <ul style="margin:0 0 20px;padding-left:18px;color:#475569;font-size:13px;line-height:1.7;">
    <li>Keep this pass safe and treat it like a ticket — do not share it or post it online.</li>
    <li>Save, download or screenshot the QR so you can show it even without internet.</li>
    <li>Show the QR at the entry scanner when you arrive.</li>
    <li>Bring a photo ID if the event requires ID verification.</li>
    <li>Quote registration ID <strong>${escapeHtml(
      data.registrationId
    )}</strong> if you lose the pass, and the organisers can re-issue it.</li>
  </ul>

  <p style="margin:0;color:#94a3b8;font-size:12px;">
    DSMNRU EventHub — this is an automated message, please do not reply.
  </p>
</div>`;

  return { subject, html };
}

/**
 * Send the registration confirmation. Never throws: registration has already
 * been committed by the time this runs, so an email outage must not turn a
 * successful registration into an error for the participant. Every outcome is
 * written to email_logs so operators can find and retry failures.
 */
export async function sendRegistrationConfirmationEmail(
  env: Env,
  data: RegistrationConfirmation
): Promise<void> {
  const baseUrl = env.FRONTEND_URL || 'http://localhost:5173';
  const { subject, html } = buildRegistrationEmail(data, baseUrl);

  let status = 'FAILED';
  let messageId: string | null = null;
  let error: string | null = null;

  try {
    const result = await sendEmail(env, data.email, subject, html);
    status = result.success ? 'SENT' : 'FAILED';
    messageId = result.messageId ?? null;
    error = result.success ? null : result.error ?? 'Unknown email provider error';
  } catch (err: any) {
    error = err?.message || String(err);
  }

  if (status !== 'SENT') {
    console.error(
      `[Email] Registration confirmation FAILED for ${data.registrationId} (${data.email}): ${error}`
    );
  }

  try {
    await env.DB.prepare(
      `INSERT INTO email_logs (id, queue_id, event_id, recipient, subject, status, error, provider_message_id)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        crypto.randomUUID(),
        data.eventId,
        data.email,
        subject,
        status,
        error,
        messageId
      )
      .run();
  } catch (logErr) {
    console.error('[Email] Could not write email_logs row for registration confirmation:', logErr);
  }
}
