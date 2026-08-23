# Email Delivery System

This document outlines the architecture, rate-limiting, and error fallback capabilities built into the email broadcast module.

## 1. Provider Abstraction Interface
To insulate the application from changing vendor pricing or limits, the email system utilizes a provider abstraction (`backend/src/utils/email.ts`):
```typescript
export async function sendEmail(
  env: Env,
  to: string,
  subject: string,
  html: string
): Promise<EmailResult>
```
If `RESEND_API_KEY` is not present, the system defaults to an elegant console logger (`Console Mock Fallback`), printing delivery targets directly to Worker stdout logs for testing and local development. This ensures zero setup friction.

## 2. Asynchronous Queue Processing
To maintain rapid response times for HTTP clients, campaigns are processed out-of-band:
1. The coordinator selects a filter (e.g. "Attendees only").
2. The server inserts the campaign and creates individual PENDING items in the `email_queue` table.
3. The server fires `ctx.waitUntil(processEmailQueue(env))` and returns a success status to the browser immediately.
4. The background thread consumes queue jobs, compiles custom variables (such as participant names), and delivers emails sequentially.

## 3. Quota Safeguards & Backoff Retry
- **Campaign limits**: Email campaigns are highly rate-limited.
- **Recipient reviews**: Coorindators must explicitly confirm target sizes (e.g. "486 recipients") before committing.
- **Exponential Backoff**: Failed attempts (e.g., recipient inbox full or network down) are marked for retry. The retry interval grows exponentially (`2^attempt * 5` minutes) up to a max of 3 attempts before status is set to `FAILED`.
- **Delivery logs**: All delivered and failed emails are logged dynamically inside `email_logs` for coordinator troubleshooting.
