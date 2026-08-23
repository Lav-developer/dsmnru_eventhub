import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env, HonoTypes, User, Session } from './types';
import { authenticate } from './utils/auth';
import { handleAppError, AppError } from './utils/errors';
import { processEmailQueue } from './utils/emailQueue';
import authRouter from './routes/auth';
import adminRouter from './routes/admin';
import departmentsRouter from './routes/departments';
import eventsRouter from './routes/events';
import registrationsRouter from './routes/registrations';
import speakersRouter from './routes/speakers';
import scheduleRouter from './routes/schedule';
import announcementsRouter from './routes/announcements';
import operationsRouter from './routes/operations';
import certificatesRouter from './routes/certificates';
import emailsRouter from './routes/emails';

const app = new Hono<HonoTypes>();

// 1. Generate Request ID and Log Request Details
app.use('*', async (c, next) => {
  const requestId = crypto.randomUUID();
  c.set('requestId', requestId);
  c.header('X-Request-ID', requestId);

  const start = Date.now();
  await next();
  const duration = Date.now() - start;

  console.log(
    `[Request] ID: ${requestId} | Method: ${c.req.method} | Path: ${c.req.path} | Status: ${c.res.status} | Duration: ${duration}ms`
  );
});

// 1.5. Body Size Limit check (prevent memory depletion/oversized payloads)
app.use('*', async (c, next) => {
  const contentLength = parseInt(c.req.header('Content-Length') || '0', 10);
  const path = c.req.path;
  
  // Stricter limits for registration/imports, standard 2MB elsewhere
  let maxLimit = 2 * 1024 * 1024; // 2MB standard
  if (path.startsWith('/api/v1/registrations/') && !path.endsWith('/export')) {
    maxLimit = 250 * 1024; // 250KB max limit for registers and pre-mapped CSV array payloads
  } else if (path.startsWith('/api/v1/auth/')) {
    maxLimit = 50 * 1024; // 50KB limit for auth login/register
  }

  if (contentLength > maxLimit) {
    throw new AppError('Payload too large', 'PAYLOAD_TOO_LARGE', 413);
  }
  await next();
});

// 2. Configure Dynamic CORS to protect against wildcard issues on production credentials
app.use(
  '*',
  cors({
    origin: (origin, c) => {
      const isProd = c.env.ENV === 'production';
      
      // Exact production origin checks (no wildcards)
      if (isProd) {
        const prodUrl = c.env.FRONTEND_URL;
        if (prodUrl && origin === prodUrl) {
          return origin;
        }
        if (origin === 'https://dsmnru-eventhub.pages.dev' || origin === 'https://eventhub.dsmnru.edu.in') {
          return origin;
        }
        return null;
      }

      // Local development and sandbox workspace environments checks
      if (
        !origin ||
        origin.startsWith('http://localhost:') ||
        origin.startsWith('http://127.0.0.1:') ||
        origin.endsWith('.e2b.app') ||
        origin.endsWith('.pages.dev') ) {
        return origin;
      }
      return null;
    },
    allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Cookie'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    exposeHeaders: ['Content-Length', 'X-Request-ID'],
    credentials: true,
    maxAge: 86400
  })
);

// 3. Security Headers Middleware
app.use('*', async (c, next) => {
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('X-XSS-Protection', '1; mode=block');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header(
    'Content-Security-Policy',
    "default-src 'none'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; connect-src 'self' https://api.resend.com; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none';"
  );
  await next();
});

// 4. Session Authentication Middleware (loads and binds c.get('user') and c.get('session'))
app.use('*', authenticate);

// 5. CSRF Origin Protection Middleware for State-Changing Authenticated Requests
app.use('*', async (c, next) => {
  const method = c.req.method;
  const isStateChanging = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method);
  
  if (isStateChanging) {
    const origin = c.req.header('Origin') || c.req.header('Referer');
    const sessionCookie = c.req.header('Cookie') || '';
    const hasSessionCookie = sessionCookie.includes('session_token=');
    
    // If authenticated via cookie, enforce strict Origin/Referer CSRF check
    if (hasSessionCookie) {
      if (!origin) {
        throw new AppError('Forbidden: CSRF check failed (missing Origin/Referer)', 'FORBIDDEN', 403);
      }
      
      const isProd = c.env.ENV === 'production';
      let isValidOrigin = false;
      
      if (isProd) {
        const prodUrl = c.env.FRONTEND_URL;
        if (prodUrl && origin.startsWith(prodUrl)) {
          isValidOrigin = true;
        } else if (
          origin.startsWith('https://dsmnru-eventhub.pages.dev') ||
          origin.startsWith('https://eventhub.dsmnru.edu.in')
        ) {
          isValidOrigin = true;
        }
      } else {
        if (
          origin.startsWith('http://localhost:') ||
          origin.startsWith('http://127.0.0.1:') ||
          origin.includes('.e2b.app') ||
          origin.includes('.pages.dev')
        ) {
          isValidOrigin = true;
        }
      }
      
      if (!isValidOrigin) {
        throw new AppError('Forbidden: CSRF check failed (invalid Origin/Referer source)', 'FORBIDDEN', 403);
      }
    }
  }
  await next();
});

// 6. Mount API Routers under /api/v1
const apiV1 = new Hono<HonoTypes>();

apiV1.route('/auth', authRouter);
apiV1.route('/admin', adminRouter);
apiV1.route('/departments', departmentsRouter);
apiV1.route('/events', eventsRouter);
apiV1.route('/registrations', registrationsRouter);
apiV1.route('/speakers', speakersRouter);
apiV1.route('/schedule', scheduleRouter);
apiV1.route('/announcements', announcementsRouter);
apiV1.route('/operations', operationsRouter);
apiV1.route('/certificates', certificatesRouter);
apiV1.route('/emails', emailsRouter);

app.route('/api/v1', apiV1);

// 7. Global Error Handling
app.onError(handleAppError);

// Cloudflare Workers exported entry points
export default {
  fetch: app.fetch,
  async scheduled(_event: any, env: Env, ctx: any) {
    console.log('[Cron] Running scheduled email queue consumer...');
    ctx.waitUntil(processEmailQueue(env));
  }
};

export type { Env };
export type { HonoTypes };
export type { User };
export type { Session };
